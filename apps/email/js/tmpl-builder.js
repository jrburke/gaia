// The builder does not rely on l10n, to avoid having to execute the l10n.js
// file as a full module in the build.
define(function () {
  return {
    load: function (id, require, onload, config) {
      require(['text!' + id], onload);
    }
  };
});
