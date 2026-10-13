process.env.SDENV_IMPERSONATE = '1';
try{require('module-alias')(require('../../utils/paths').basePath)}catch(e){};
const vm = require('vm');
const { jsdomFromText } = require('sdenv');
const dom = jsdomFromText('<html><body></body></html>', {
  url: 'https://pmos.nx.sgcc.com.cn:10443/',
  runScripts: 'outside-only',
  beforeParse: (window, sdenv) => {
    sdenv.getHandle('battery')('charging_success');
    sdenv.getHandle('dateAndRandom')({});
  },
});
const out = vm.runInContext(`JSON.stringify({
  dateNow: String(Date.now()),
  newDateGetTime: String(new Date().getTime()),
  valueOf: String(new Date().valueOf()),
  toISOString: new Date().toISOString(),
  perfNow: typeof performance !== 'undefined' ? String(Math.round(performance.now())) : 'noperf',
  mathRandom: String(Math.random()),
})`, dom.getInternalVMContext());
console.log(out);
