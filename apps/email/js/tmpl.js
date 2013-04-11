
define(['l10der!'], function (mozL10n) {
  return {
    load: function (id, require, onload, config) {
      if (config.isBuild) {
        return onload();
      }

      var xhr = new XMLHttpRequest(),
          url = require.toUrl(id);

      xhr.open('GET', url, true);
      xhr.onreadystatechange = function (evt) {
        var status, err;
        if (xhr.readyState === 4) {
          status = xhr.status;
          if (status > 399 && status < 600) {
            // An http 4xx or 5xx error. Signal an error.
            err = new Error(url + ' HTTP status: ' + status);
            err.xhr = xhr;
            onload.error(err);
          } else {
            // Use a doc fragment, because the raw text may have
            // comments. However, once in the fragment, get the
            // first child *element* node to use as the template.
            var temp = document.createElement('div');
            temp.innerHTML = xhr.responseText;
            var node = temp.children[0];
            mozL10n.translate(node);
            onload(node);
          }
        }
      };
      xhr.send(null);
    }
  };
});
