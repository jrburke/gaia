define(function (mozL10n) {
  var value;
  return {
    load: function (id, require, onload, config) {
      if (config.isBuild || value)
        return onload(value);

      require(['l10n'], function (mozL10n) {
        mozL10n.ready(function () {
          if (!value)
            value = mozL10n;

          onload(mozL10n);
        });
      });
    }
  };
});
