define(['l10n'], function (mozL10n) {
  return {
    pluginBuilder: './tmpl-builder',

    load: function (id, require, onload, config) {
      require(['text!' + id], function (text) {
        if (config.isBuild) {
          return onload();
        }

        var temp = document.createElement('div');
        temp.innerHTML = text;
        var node = temp.children[0];
        mozL10n.translate(node);
        onload(node);
      });
    }
  };
});
