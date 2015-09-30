'use strict';
define(function () {
  return function modelRender(modelIds) {
    if (!Array.isArray(modelIds)) {
      modelIds = [modelIds];
    }

    return {
      // Custom element lifecycle method, called when the element is created.
      createdCallback: function () {
        this.renderModel = null;
        this.state = {};
      },

      onArgs: function(args) {
        if (this.renderModel) {
          this.renderModel.removeObjectListener(this);
        }

        this.renderModel = args.model;

        // Listen for changes in the model IDs, but also set up initial state
        // values.
        modelIds.forEach((modelId) => {
          // Using the `this` form of on() so that it is easy to remove all
          // listeners tied to this object via removeObjectListener.
          this.renderModel.on(modelId, this, (modelValue) => {
            this.state[modelId] = modelValue;
            this.render();
          });

          this.state[modelId] = this.renderModel[modelId];
        });

        this.render();
      },

      // Custom element lifecycle method, called when removed from the DOM.
      detachedCallback: function() {
        if (this.renderModel) {
          this.renderModel.removeObjectListener(this);
        }
      }
    };
  };
});
