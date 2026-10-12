/*
 * 指纹环境补齐: canvas/WebGL 返回真实浏览器(Mac Chrome)采集值
 * 数据文件: fingerprint/canvas-fp.txt (完整dataURL)
 */
const fs = require('fs');
const path = require('path');

const WEBGL_VENDOR = 'Google Inc. (Apple)';
const WEBGL_RENDERER = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)';
const WEBGL_VERSION = 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';

let CANVAS_FP = '';
try {
  CANVAS_FP = fs.readFileSync(path.join(__dirname, 'fingerprint', 'canvas-fp.txt'), 'utf8').trim();
} catch (e) { /* 指纹文件缺失时���退空 */ }

module.exports = (sdenv) => {
  const window = sdenv.memory.window;
  const setFuncNative = sdenv.tools.setFuncNative;

  const origGetContext = window.HTMLCanvasElement.prototype.getContext;
  window.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === 'webgl' || type === 'experimental-webgl') {
      return makeWebGLStub();
    }
    return origGetContext.call(this, type, ...rest);
  };
  setFuncNative(window.HTMLCanvasElement.prototype.getContext, 'getContext', 1);

  if (CANVAS_FP) {
    window.HTMLCanvasElement.prototype.toDataURL = function () {
      return CANVAS_FP;
    };
    setFuncNative(window.HTMLCanvasElement.prototype.toDataURL, 'toDataURL', 0);
  }

  function makeWebGLStub() {
    if (makeWebGLStub._cache) return makeWebGLStub._cache;
    const params = {
      37445: WEBGL_VENDOR,
      37446: WEBGL_RENDERER,
      7936: 'WebKit',
      7937: 'WebKit WebGL',
      7938: WEBGL_VERSION,
      35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    };
    const noop = () => {};
    const stub = {
      getParameter: (p) => params[p] !== undefined ? params[p] : 0,
      getExtension: (name) => {
        if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
        return {};
      },
      getSupportedExtensions: () => ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float', 'EXT_float_blend', 'OES_texture_float', 'WEBGL_debug_renderer_info'],
      getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, desynchronized: false, failIfMajorPerformanceCaveat: false, powerPreference: 'default', premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false, xrCompatible: false }),
      createShader: () => ({}),
      shaderSource: noop, compileShader: noop, getShaderParameter: () => true, getShaderInfoLog: () => '',
      createProgram: () => ({}), attachShader: noop, linkProgram: noop,
      getProgramParameter: () => true, getProgramInfoLog: () => '',
      useProgram: noop, createBuffer: () => ({}), bindBuffer: noop, bufferData: noop,
      getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
      createTexture: () => ({}), bindTexture: noop, texImage2D: noop, texParameteri: noop,
      clearColor: noop, enable: noop, disable: noop, blendFunc: noop, viewport: noop,
      createVertexArray: () => ({}), bindVertexArray: noop,
      drawingBufferWidth: 300, drawingBufferHeight: 150,
      isContextLost: () => false,
    };
    makeWebGLStub._cache = stub;
    return stub;
  }
};
