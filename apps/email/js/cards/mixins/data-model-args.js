define(function (require) {
  'use strict';
  var selectOwnElements = require('./select_own_elements');

  return function dataModelArgs() {
    selectOwnElements('[data-model-args]', this, (node) => {
      node.args = {
        model: this.args.model
      };

      if (node.onArgs) {
        node.onArgs(node.args);
      }
    });
  };
});
