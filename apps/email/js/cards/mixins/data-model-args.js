'use strict';
define(function (require) {
  var selectOwnElements = require('./select_own_elements');

  return {
    onArgs: function (args) {
      selectOwnElements('[data-model-args]', this, (node) => {
        node.args = {
          model: args.model
        };

        if (node.onArgs) {
          node.onArgs(node.args);
        }
      });
    }
  };
});
