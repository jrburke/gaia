define(function () {
  'use strict';

  function callRender(element) {
    // console.log('> rendering: ' + element.nodeName);
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

        // If no model IDs passed in, then just immediately trigger a render.
        if (!modelIds.length) {
          callRender(this);
        }
      },

      onArgs: function(args) {
        if (this.model) {
          this.model.removeObjectListener(this);
        }

        this.model = args.model;

        // Listen for changes in the model IDs, but also set up initial state
        // values.
        modelIds.forEach((modelId) => {
          var modelTarget,
              modelParts = modelId.split('.'),
              usesThis = modelParts[0] === 'this';

          if (usesThis) {
            modelTarget = this;
            modelId = modelParts[1];
          } else {
            modelTarget = this.model;
            if (!modelTarget) {
              throw new Error('model not passed to onArgs in ' + this.nodeName);
            }
          }

          // Using the `this` form of on() so that it is easy to remove all
          // listeners tied to this object via removeObjectListener.
          modelTarget.on(modelId, this, (modelValue) => {
            var oldValue = this.state[modelId];

            // Remove old change event listener, but only if not a "this"
            // property, since those do not register for the "change" events
            // below.
            if (!usesThis && oldValue && oldValue.removeObjectListener) {
              oldValue.removeObjectListener(this);
            }

            this.state[modelId] = modelValue;

            // Listen for change events, but only only if not a "this" property,
            // since it is unclear if they have nested property changes.
            if (!usesThis && modelValue && modelValue.removeObjectListener) {
              modelValue.on('change', this, () => {
                callRender(this);
              });
            }

            callRender(this);
          });

          this.state[modelId] = this.model[modelId];
        });

        // Allow some components to just model render when this.model is set.
        if (this.model) {
          this.emit('model', this.model);
        }

        // Since the model listening above is "on" and not "latest", trigger
        // a render here. This helps reduce the number of renders for multiple
        // model listeners to just one call instead of many, if "latest" was
        // used. However, if the component is only wanting render when
        // 'this.model' is used, then skip it since the model emit above will
        // have done it.
        if (modelIds.length > 1 || modelIds[0] !== 'this.model') {
          callRender(this);
        }
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
