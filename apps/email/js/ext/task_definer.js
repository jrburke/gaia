define(function (require) {
  'use strict';

  var co = require('co');
  var mix = require('mix');
  var { shallowClone } = require('./util');

  var SimpleTaskBase = {
    isSimple: true,
    isComplex: false,

    /**
     * No-op planning phase that just handles prioritization.
     */
    plan: co.wrap(function* (ctx, rawTask) {
      var decoratedTask = shallowClone(rawTask);
      if (this.exclusiveResources) {
        decoratedTask.exclusiveResources = this.exclusiveResources(rawTask);
      }
      if (this.priorityTags) {
        decoratedTask.priorityTags = this.priorityTags(rawTask);
      }
      yield ctx.finishTask({
        taskState: decoratedTask
      });
    }),
    execute: null
  };

  var ComplexTaskBase = {
    isSimple: false,
    isComplex: true
  };

  /**
   * Singleton support logic
   */
  function TaskDefiner() {}
  TaskDefiner.prototype = {
    /**
     * Define a task that's fully characterized by its name an arguments and along
     * with some other simple configuration, the task infrastructure is able to
     * handle all the state management.
     */
    defineSimpleTask: function (mixparts) {
      var task = {};
      mix(task, SimpleTaskBase, true);
      for (var part of mixparts) {
        mix(task, part, true);
      }

      return task;
    },

    /**
     * Define a task that maintains its own aggregate state and handles all task
     * mooting, unification, etc.
     */
    defineComplexTask: function (mixparts) {
      var task = {};
      mix(task, ComplexTaskBase, true);
      for (var part of mixparts) {
        mix(task, part, true);
      }

      return task;
    }
  };

  return new TaskDefiner();
});
