'use strict';
define(function (require) {
  var selectOwnElements = require('./select_own_elements');

  return {
    templateInsertedCallback: function () {
      selectOwnElements('[data-prop]', this, (node) => {
        this[node.dataset.prop] = node;
      });
    }
  };
});
