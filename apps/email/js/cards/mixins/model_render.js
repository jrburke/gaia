'use strict';
define(function () {
  function callRender(element) {
    element.render();
    if (element.renderEnd) {
      element.renderEnd();
    }
  }

  return function modelRender(modelIds) {
    if (!modelIds) {
      modelIds = [];
    } else if (!Array.isArray(modelIds)) {
      modelIds = [modelIds];
    }

    return {
      // Custom element lifecycle method, called when the element is created.
      createdCallback: function () {
        this.model = null;
        this.state = {};
      },

      onArgs: function(args) {
        if (this.model) {
          this.model.removeObjectListener(this);
        }

        this.model = args.model;

        // Listen for changes in the model IDs, but also set up initial state
        // values.
        modelIds.forEach((modelId) => {
          // Using the `this` form of on() so that it is easy to remove all
          // listeners tied to this object via removeObjectListener.
          this.model.on(modelId, this, (modelValue) => {
            var oldValue = this.state[modelId];

            // Remove old change event listener.
            if (oldValue && oldValue.removeObjectListener) {
              oldValue.removeObjectListener(this);
            }

            this.state[modelId] = modelValue;

            // Listen for change events.
            if (modelValue && modelValue.removeObjectListener) {
              modelValue.on('change', this, () => {
                callRender(this);
              });
            }

            callRender(this);
          });

          this.state[modelId] = this.model[modelId];
        });

        callRender(this);
      },

      removeModelRenderListeners: function() {
        if (this.model) {
          this.model.removeObjectListener(this);
        }
      },

      // Custom element lifecycle method, called when removed from the DOM.
      detachedCallback: function() {
        this.removeModelRenderListeners();
      }
    };
  };
});
