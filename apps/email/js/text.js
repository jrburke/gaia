'use strict';
define(function(require) {

var xfetch = require('xfetch');

return {
  load: function(name, req, onload, config) {
    var url = req.toUrl(name);
    xfetch(url).then(onload, onload.error);
  }
};

});
