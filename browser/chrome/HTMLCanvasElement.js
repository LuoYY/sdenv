/*
 * 指纹环境补齐: canvas/WebGL 返回真实浏览器采集值
 * 数据文件: fingerprint/canvas-fp.txt (完整dataURL, 280x60 标准指纹画布采集)
 * 注意: WebGL 字符串须与 FP 的 Win10/Chrome144 指纹一致(UA 与 GPU 平台矛盾是典型检测点);
 * canvas 像素 dataURL 为 Mac 采集(像素哈希平台不透明, 保留)
 */
const fs = require('fs');
const path = require('path');

const WEBGL_VENDOR = 'Google Inc. (NVIDIA)';
const WEBGL_RENDERER = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const WEBGL_VERSION = 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';

let CANVAS_FP = '';
try {
  CANVAS_FP = fs.readFileSync(path.join(__dirname, 'fingerprint', 'canvas-fp.txt'), 'utf8').trim();
} catch (e) { /* 指纹文件缺失时���退空 */ }

module.exports = (sdenv) => {
  const window = sdenv.memory.window;
  const setFuncNative = sdenv.tools.setFuncNative;

  const origGetContext = window.HTMLCanvasElement.prototype.getContext;
  // 同一 canvas 重复 getContext('2d') 须返回同一实例(浏览器行为), 用 WeakMap 隐藏缓存
  const ctx2dCache = new WeakMap();
  window.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === '2d') {
      if (!ctx2dCache.has(this)) ctx2dCache.set(this, make2DStub(this));
      return ctx2dCache.get(this);
    }
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

  // 2d 桩: 绘制方法 no-op(toDataURL 已固定为采集指纹, 绘制内容不影响结果),
  // 读取类方法返回合理值; 挂在 window.CanvasRenderingContext2D 原型链上保 instanceof 通过
  function make2DStub(canvas) {
    const noop = () => {};
    const ctx = Object.create(window.CanvasRenderingContext2D.prototype);
    for (const m of [
      'fillText', 'strokeText', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath',
      'arc', 'arcTo', 'ellipse', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo',
      'fill', 'stroke', 'rect', 'clip', 'translate', 'rotate', 'scale', 'setTransform', 'transform',
      'drawImage', 'putImageData', 'setLineDash', 'save', 'restore',
    ]) ctx[m] = noop;
    ctx.measureText = (text) => {
      const w = String(text).length * 7;
      return { width: w, actualBoundingBoxLeft: 0, actualBoundingBoxRight: w, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3, alphabeticBaseline: 0, emHeightAscent: 10, emHeightDescent: 3, hangingBaseline: 0, ideographicBaseline: 0 };
    };
    ctx.getImageData = (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' });
    ctx.createImageData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    ctx.getLineDash = () => [];
    ctx.isPointInPath = () => false;
    ctx.isPointInStroke = () => false;
    ctx.getContextAttributes = () => ({ alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false });
    const grad = { addColorStop: noop };
    ctx.createLinearGradient = ctx.createRadialGradient = ctx.createConicGradient = () => grad;
    ctx.createPattern = () => ({});
    Object.assign(ctx, {
      canvas,
      fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif',
      textAlign: 'start', textBaseline: 'alphabetic', direction: 'inherit',
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
      lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
      shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none',
    });
    setFuncNative(ctx.measureText, 'measureText', 1);
    setFuncNative(ctx.getImageData, 'getImageData', 4);
    return ctx;
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
