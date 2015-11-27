'use strict';
define(function () {
  var slice = Array.prototype.slice;

  return {
    onArgs: function (args) {
      slice.call(this.querySelectorAll('[data-model-args]'))
      .forEach((node) => {
        var parent = node;
        // Make sure the node is not nested in another component.
        while ((parent = parent.parentNode)) {
          if (parent.nodeName.indexOf('-') !== -1) {
            if (parent !== this) {
              return;
            }
            break;
          }
        }
        if (!parent) {
          return;
        }

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
