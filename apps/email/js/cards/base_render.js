'use strict';
define(function(require) {
  return function base_render(modelIds, renderFn) {
    // Allow just passing the render function, no model IDs to watch.
    if (!renderFn) {
      renderFn = modelIds;
      modelIds = [];
    }

    // Set up the base mixin
    return [
      require('./base_event'),
      require('./mixins/model_render')(modelIds),
      {
        render: require('htemplate')(renderFn)
      }
    ];
  };
});
