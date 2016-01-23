define(function(require) {
  'use strict';

  var elementDeps = require('element_deps'),
      htemplate = require('htemplate'),
      selectOwnElements = require('./mixins/select_own_elements');

  return function base_render(modelIds, renderFn) {
    // Allow just passing the render function, no model IDs to watch.
    if (!renderFn) {
      renderFn = modelIds;
      modelIds = [];
    }

    // Set up the base mixin
    return [
      require('./base_event'),

      require('./mixins/extra_classes'),
      require('./mixins/onback'),

      {
        // Custom element lifecycle method, called when the element is created.
        // PLACE THIS BEFORE model_render, since model_render can replace the
        // innerHTML contents, which would wipe out the data-slot-id elements.
        createdCallback: function() {
          // Indicate this is an email custom element. Helps with cache
          // behaviors.
          this.classList.add('email-ce');

          // Find any children that are data-slots and hold on to them for
          // later. Only consider direct children.
          [...this.children].forEach(element => {
            var slotName = element.dataset.slotId;
            if (slotName) {
              var slots = this.slots || (this.slots = {});
              slots[slotName] = element;
              // Remove from the DOM, unless it is already slotted.
              if (!element.dataset.slotted) {
                element.parentNode.removeChild(element);
              }
            }
          });

          // If this is a cache restore, the slots might already be slotted, so
          // restore them.
          [...this.querySelectorAll('[data-slotted]')].forEach(element => {
            var slotName = element.dataset.slotId;
            if (slotName) {
              var slots = this.slots || (this.slots = {});
              if (!slots.hasOwnProperty(slotName)) {
                slots[slotName] = element;
              }
            }
          });
        },

        // Called by 'element', gives a chance to load custom element
        // dependencies before this custom element is registered.
        elementParseDeps: function(req, cb) {
          var fnText = this.renderFunctionRaw.toString(),
              deps = elementDeps(elementDeps.removeJsComments(fnText));

          if (deps.length) {
            req(deps, cb);
          } else {
            cb();
          }
        },

        render: htemplate(renderFn, {
          verifyFn: function(tagResult) {
            // Make sure all custom tags are loaded.
            var text = tagResult.text,
                depIds = elementDeps(text);

            var undefinedDeps = [];
            depIds.forEach(function(depId) {
              if (!require.defined(depId)) {
                undefinedDeps.push(depId);
              }
            });

            if (undefinedDeps.length) {
              throw new Error(this.nodeName.toLowerCase() + ' depends on ' +
                              undefinedDeps);
            }
          }
        }),

        // Store raw render function for use in inspecting it for custom element
        // dependencies.
        renderFunctionRaw: renderFn,

        renderEndMixins: [
          require('./mixins/data-event'),
          require('./mixins/data-model-args'),
          require('./mixins/data-pass-prop'),
          require('./mixins/data-prop'),
        ],

        renderEnd: function() {
          //todo: Would be nice to only run this if render did actually
          // change the DOM.
          if (this.slots) {
            selectOwnElements('data-slot', this, (slotElement) => {
              var replacement = this.slots[slotElement.dataset.slotId];
              if (replacement) {
                replacement.setAttribute('data-slotted', 'slotted');
                slotElement.parentNode.replaceChild(replacement, slotElement);
              } else {
                // Remove the slot, not used.
                slotElement.parentNode.removeChild(slotElement);
              }
            });
          }

          if (this.renderEndMixins) {
            this.renderEndMixins.forEach((mixin) => {
              // Intermediate workaround, can be removed if all cards move away
              // from the templateInsertedCallback approach.
              mixin = mixin.templateInsertedCallback || mixin;
              mixin.call(this);
            });
          }
        }
      },

      // Placed after the createdCallback since it can wipe out the innerHTML
      // contents.
      require('./mixins/model_render')(modelIds)
    ];
  };
});
