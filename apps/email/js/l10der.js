define(function (mozL10n) {
  var value;
  return {
    load: function (id, require, onload, config) {
      if (config.isBuild || value)
        return onload(value);

console.log('@@@@l10der calling l10n: ' + (performance.now() - _xstart));

      //require(['l10n'], function (mozL10n) {
console.log('@@@@l10der got l10n: ' + (performance.now() - _xstart));

        //mozL10n.ready(function () {
          if (!value)
            value = navigator.mozL10n;

          onload(navigator.mozL10n);
console.log('@@@@l10der onload called above: ' + (performance.now() - _xstart));

        //});
      //});
    }
  };
});
