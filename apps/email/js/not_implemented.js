'use strict';

define(function(require) {
  return function notImplemented(featureName = '') {
    require('confirm_dialog').show(featureName +
                                   ' not implemented yet', function() {});
  };
});
