'use strict';
define(function (require) {
  var selectOwnElements = require('./select_own_elements');

  return {
    templateInsertedCallback: function () {
      selectOwnElements('[data-pass-prop]', this, (node) => {
        var props = node.dataset.passProp.split(',');
        props.forEach((prop) => {
          var fromName, toName,
              parts = prop.split(':');

          if (!parts[1]) {
            parts[1] = parts[0];
          }
          fromName = parts[0].trim();
          toName = parts[1].trim();

          node[toName] = fromName === 'this' ? this : this[fromName];
        });
      });
    }
  };
});
