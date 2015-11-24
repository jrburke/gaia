define(function (require) {
  'use strict';

  var selectOwnElements = require('./select_own_elements');

  return {
    templateInsertedCallback: function () {
      selectOwnElements('[data-pass-prop]', this, (node) => {
        var props = node.dataset.passProp.split(',');
        props.forEach((prop) => {
          var fromName, toName, bindThis,
              parts = prop.split(':');

          if (!parts[1]) {
            parts[1] = parts[0];
          }
          fromName = parts[0].trim();
          toName = parts[1].trim();

          if (fromName.indexOf('=>') === 0) {
            fromName = fromName.substring(2);
            bindThis = true;
          }

          node[toName] = fromName === 'this' ?
                         this : bindThis ?
                                this[fromName].bind(this) : this[fromName];
        });
      });
    }
  };
});
