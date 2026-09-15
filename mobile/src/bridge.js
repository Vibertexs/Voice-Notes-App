/**
 * The script injected into the WebView before the web app boots.
 *
 * It makes the unmodified web build run with no server behind it, by taking
 * over the two browser APIs it depends on:
 *
 *   fetch('/api/...')  -> a message to native, answered from SQLite
 *   MediaRecorder      -> a message to native, answered by expo-audio
 *
 * Recording is the reason the WebView cannot simply use the browser APIs: a
 * WebView's MediaRecorder is suspended when the screen locks, which is exactly
 * the case this app exists to handle. Audio is captured natively and never
 * crosses the bridge - only a token naming the file on disk does.
 *
 * Written as ES5 in a plain string: it runs before any bundle, on whatever
 * engine the platform's WebView provides, with no transpiler in front of it.
 */
export const BRIDGE_JS = String.raw`
(function () {
  if (window.__CN_BRIDGE__) return;
  window.__CN_BRIDGE__ = true;

  var seq = 0;
  var pending = {};

  function call(channel, payload) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      window.ReactNativeWebView.postMessage(JSON.stringify({
        id: id, channel: channel, payload: payload
      }));
    });
  }

  // Native calls this to answer a pending request.
  window.__cnSettle = function (id, ok, data) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    if (ok) entry.resolve(data);
    else entry.reject(new Error((data && data.message) || 'The app could not complete that.'));
  };

  // ---------------------------------------------------------------- fetch --

  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  function readBlob(blob) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { resolve(''); };
      reader.readAsText(blob);
    });
  }

  // A recording never travels as bytes. The shim recorder hands the page a
  // token instead of audio, and it is swapped back for the file here.
  function unwrapPart(value) {
    if (typeof value === 'string') return Promise.resolve(value);
    if (value && typeof value.size === 'number') {
      return readBlob(value).then(function (text) {
        try {
          var parsed = JSON.parse(text);
          if (parsed && parsed.__cnRecording) return { __recording: parsed.__cnRecording };
        } catch (ignored) { /* a real file, not a token */ }
        return { __file: { name: value.name || 'file', type: value.type || '', text: text } };
      });
    }
    return Promise.resolve(value);
  }

  function serializeBody(body) {
    if (!body) return Promise.resolve(null);
    if (typeof body === 'string') {
      try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.resolve(body); }
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      var keys = [];
      var values = [];
      body.forEach(function (value, key) { keys.push(key); values.push(unwrapPart(value)); });
      return Promise.all(values).then(function (resolved) {
        var out = {};
        for (var i = 0; i < keys.length; i++) out[keys[i]] = resolved[i];
        return out;
      });
    }
    return Promise.resolve(body);
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') !== 0) {
      if (realFetch) return realFetch(input, init);
      return Promise.reject(new Error('Offline.'));
    }
    var options = init || {};
    var method = String(options.method || 'GET').toUpperCase();

    return serializeBody(options.body)
      .then(function (body) { return call('api', { method: method, path: url, body: body }); })
      .then(function (result) {
        var payload = result && result.body !== undefined ? result.body : null;
        return new Response(JSON.stringify(payload), {
          status: (result && result.status) || 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });
  };

  // ------------------------------------------------------------ microphone --

  // The page only needs the stream as a handle to stop and to visualise, so a
  // stand-in is enough. Native owns the actual microphone.
  function FakeStream() {
    this.__cnFake = true;
    this.__tracks = [{ kind: 'audio', stop: function () {}, enabled: true }];
  }
  FakeStream.prototype.getTracks = function () { return this.__tracks; };
  FakeStream.prototype.getAudioTracks = function () { return this.__tracks; };

  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  navigator.mediaDevices.getUserMedia = function () {
    return call('mic.permission', {}).then(function (granted) {
      if (!granted || !granted.ok) throw new Error('Microphone permission denied');
      return new FakeStream();
    });
  };

  // The waveform reads RMS off an AnalyserNode. There is no real audio graph
  // here, so the analyser is fed a synthetic trace whose amplitude follows the
  // metering level native reports - the drawing code stays untouched.
  window.__cnLevel = 0;
  window.__cnSetLevel = function (value) { window.__cnLevel = Number(value) || 0; };

  if (typeof AudioContext !== 'undefined') {
    var realCreateSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      if (!stream || !stream.__cnFake) return realCreateSource.call(this, stream);
      return { connect: function (node) { if (node) node.__cnSynthetic = true; return node; },
               disconnect: function () {} };
    };

    if (typeof AnalyserNode !== 'undefined') {
      var realGetFloat = AnalyserNode.prototype.getFloatTimeDomainData;
      AnalyserNode.prototype.getFloatTimeDomainData = function (array) {
        if (!this.__cnSynthetic) return realGetFloat.call(this, array);
        // RMS of a sine of amplitude A is A/sqrt(2); invert so the level the
        // user sees matches the level native measured.
        var amplitude = Math.min(1, window.__cnLevel) * 1.414;
        for (var i = 0; i < array.length; i++) {
          array[i] = Math.sin(i / 7) * amplitude * (0.75 + Math.random() * 0.25);
        }
        return undefined;
      };
    }
  }

  // --------------------------------------------------------- MediaRecorder --

  function ShimRecorder(stream, options) {
    this.stream = stream;
    this.state = 'inactive';
    this.mimeType = (options && options.mimeType) || 'audio/mp4';
    this.__listeners = {};
    this.__recordingId = null;
  }

  ShimRecorder.prototype.addEventListener = function (name, handler) {
    (this.__listeners[name] = this.__listeners[name] || []).push(handler);
  };
  ShimRecorder.prototype.removeEventListener = function (name, handler) {
    var list = this.__listeners[name] || [];
    var index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
  ShimRecorder.prototype.__emit = function (name, event) {
    var list = (this.__listeners[name] || []).slice();
    for (var i = 0; i < list.length; i++) list[i].call(this, event || { type: name });
    var inline = this['on' + name];
    if (typeof inline === 'function') inline.call(this, event || { type: name });
  };

  ShimRecorder.prototype.start = function () {
    var self = this;
    self.state = 'recording';
    call('rec.start', {}).then(function (result) {
      self.__recordingId = result.id;
    }).catch(function (error) {
      self.state = 'inactive';
      self.__emit('error', { type: 'error', error: error, message: error.message });
    });
  };

  ShimRecorder.prototype.pause = function () {
    this.state = 'paused';
    call('rec.pause', {}).catch(function () {});
  };

  ShimRecorder.prototype.resume = function () {
    this.state = 'recording';
    call('rec.resume', {}).catch(function () {});
  };

  ShimRecorder.prototype.stop = function () {
    var self = this;
    call('rec.stop', {}).then(function (result) {
      self.state = 'inactive';
      // The token stands in for the audio. It is swapped for the file on disk
      // when the page posts it back, so the bytes never cross the bridge.
      var token = JSON.stringify({ __cnRecording: result.id });
      self.__emit('dataavailable', {
        type: 'dataavailable',
        data: new Blob([token], { type: self.mimeType })
      });
      self.__emit('stop', { type: 'stop' });
    }).catch(function (error) {
      self.state = 'inactive';
      self.__emit('error', { type: 'error', error: error, message: error.message });
      self.__emit('stop', { type: 'stop' });
    });
  };

  ShimRecorder.isTypeSupported = function () { return true; };
  window.MediaRecorder = ShimRecorder;

  // ------------------------------------------------------------------ misc --

  // Tells the web app it is running inside the native shell, so it can hide
  // anything that has no meaning here.
  window.__CN_NATIVE__ = true;
  document.documentElement.setAttribute('data-native', 'true');

  true;
})();
`;
