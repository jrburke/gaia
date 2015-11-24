'use strict';
define(function (require) {
  var selectOwnElements = require('./select_own_elements');

  return {
    templateInsertedCallback: function () {
      selectOwnElements('[data-event]', this, (node) => {
        // Value is of type 'name:value,name:value',
        // with the :value part optional.
        node.dataset.event.split(',').forEach((pair) => {
          var evtName, method,
              parts = pair.split(':');

          if (!parts[1]) {
            parts[1] = parts[0];
          }
          evtName = parts[0].trim();
          method = parts[1].trim();

          if (typeof this[method] !== 'function') {
            throw new Error(this.nodeName.toLowerCase() + ': "' + method +
                            '" is not a function, cannot bind with data-event');
          }

          node.addEventListener(evtName, (evt) => {
            // Treat these events as private to the
            // custom element.
            evt.stopPropagation();
            return this[method](evt);
          }, false);
        });
      });
    }
  };
});
