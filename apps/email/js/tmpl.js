define(function (mozL10n) {
  return {
    load: function (id, require, onload, config) {
      require(['text!' + id], function (text) {
        if (config.isBuild) {
          return onload();
        }

        var temp = document.createElement('div');
        temp.innerHTML = text;
        var node = temp.children[0];
        navigator.mozL10n.translate(node);
        onload(node);
      });
    }
  };
});
