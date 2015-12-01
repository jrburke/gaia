define(function (require) {
  'use strict';

  const logic = require('logic');

  const FibonacciHeap = require('../ext/fibonacci-heap');

  /**
   * Helper class for use by TaskManager that is in charge of maintaining the
   * priority queue of tasks that are currently ready for execution.
   *
   *
   * TODO: Implement exclusive resource support or give up.
   */
  function TaskPriorities() {
    logic.defineScope(this, 'TaskPriorities');

    /**
     * Heap tracking our prioritized tasks/markers by priority.  This only
     * includes tasks/priorities that are not deferred awaiting the availability
     * of a resource or a timeout; those are tracked/held by TaskResources.
     */
    this._prioritizedTasks = new FibonacciHeap();

    /**
     * @type {Map<TaskId, HeapNode>}
     * Maps TaskIds to the HeapNode where they are contained as a value.  Used
     * for re-prioritization of complex tasks as their markers are updated as well
     * as for removal of tasks by `TaskResources` when resources are revoked.
     * Note that `_priorityTagToHeapNodes` directly maps priority tags for
     * priority tag updates.
     *
     * Entries are removed from this map as they are removed from the
     * FibonacciHeap.
     */
    this._taskIdToHeapNode = new Map();

    /**
     * @type {Map<PriorityTag, HeapNode[]>}
     * Maps priority tags to the FibonacciHeap nodes holding a simple wrappedTask
     * or a complex task marker.
     */
    this._priorityTagToHeapNodes = new Map();
    /**
     * @type {Map<PriorityOwner, Map<PriorityTag, PriorityBoost>>}
     * Maps owners to their current maps of priority tags and their relative
     * priority boosts.  (Positive numbers are a boost, negative numbers are a
     * penalty.)
     */
    this._priorityTagsByOwner = new Map();

    /**
     * Maps priority tags to the sum of all of the values in the maps stored in
     * _priorityTagsByOwner.  Keys/values are deleted when they go to zero.  This
     * is updated incrementally, not re-tallied.
     */
    this._summedPriorityTags = new Map();
  }
  TaskPriorities.prototype = {
    /**
     * Do we have any tasks that are ready to execute?  AKA, will
     * `popNextAvailableTask` return something other than null?
     */
    hasTasksToExecute: function () {
      return this._prioritizedTasks.isEmpty();
    },

    get numTasksToExecute() {
      return this._prioritizedTasks.nodeCount;
    },

    /**
     * Retrieve a task for execution.  The task will no longer be tracked by
     * `TaskPriorities` at all; error handling logic at higher levels is
     * responsible for rescheduling the task if appropriate.
     */
    popNextAvailableTask: function () {
      var priorityNode = this._prioritizedTasks.extractMinimum();
      if (!priorityNode) {
        return null;
      }
      var taskThing = priorityNode.value;
      this._taskIdToHeapNode.delete(taskThing.id);
      this._cleanupTaskPriorityTracking(taskThing, priorityNode);

      return taskThing;
    },

    /**
     * Given a set of priority tags, sum them up and return them.  Note that the
     * caller is responsible for applying any specific relative priority
     * adjustment itself.
     */
    _computePriorityForTags: function (priorityTags) {
      var summedPriorityTags = this._summedPriorityTags;
      var priority = 0;
      if (priorityTags) {
        for (var priorityTag of priorityTags) {
          priority += summedPriorityTags.get(priorityTag) || 0;
        }
      }
      return priority;
    },

    /**
     * Updates the priority boost tags associated with the given owningId, like
     * when the user changes what they're looking at.  Pass null to clear the
     * existing priority boost tags.
     *
     * @param {String} owningId
     *   A non-colliding identifier amongst the other priority users.  The
     *   tentative convention is to just use bridge handles or things prefixed
     *   with them since all priorities flow from explicit user action.
     * @param {Map} tagsWithValues
     *   A map whose keys are tag names and values are (positive) priority boosts
     *   for tasks/markers possessing that tag.  The Map must *not* be mutated
     *   after it is passed-in.  (We could be defensive about this, but all our
     *   callers should be in-GELAM so it shouldn't be hard to comply.)
     */
    setPriorityBoostTags: function (owningId, tagsWithValues) {
      // This is a 2-pass implementation:
      // 1) Accumulate per-task/marker priority deltas stored in a map.
      // 2) Apply those deltas to the priority heap.
      // We don't want to update the heap as we go because

      var existingValues = this._priorityTagsByOwner.get(owningId) || new Map();
      var newValues = tagsWithValues || new Map();
      var perThingDeltas = new Map();

      var summedPriorityTags = this._summedPriorityTags;
      var priorityTagToHeapNodes = this._priorityTagToHeapNodes;

      if (tagsWithValues) {
        this._priorityTagsByOwner.set(owningId, tagsWithValues);
      } else {
        this._priorityTagsByOwner.delete(owningId);
      }

      // -- Phase 1: accumulate deltas (and update sums)
      var applyDelta = function (priorityTag, delta) {
        // - update sum
        var newSum = (summedPriorityTags.get(priorityTag) || 0) + delta;
        if (newSum) {
          summedPriorityTags.set(priorityTag, newSum);
        } else {
          summedPriorityTags.delete(priorityTag);
        }

        // - per-taskthing deltas
        var nodes = priorityTagToHeapNodes.get(priorityTag);
        if (nodes) {
          for (var node of nodes) {
            var aggregateDelta = (perThingDeltas.get(node) || 0) + delta;
            perThingDeltas.set(node, aggregateDelta);
          }
        }
      };

      // - Iterate over newValues for new/changed values.
      for (var [priorityTag, newPriority] of newValues.entries()) {
        var oldPriority = existingValues.get(priorityTag) || 0;
        var priorityDelta = newPriority - oldPriority;
        applyDelta(priorityTag, priorityDelta);
      }
      // - Iterate over existingValues for deletions
      for (var [priorityTag, oldPriority] of existingValues.entries()) {
        if (newValues.has(priorityTag)) {
          continue;
        }
        applyDelta(priorityTag, -oldPriority);
      }

      // -- Phase 2: update the priority heap
      for (var [node, aggregateDelta] of perThingDeltas.values()) {
        // The heap allows us to reduce keys (Which, because we negate them, means
        // priority increases) efficiently, but otherwise we need to remove the
        // thing and re-add it.
        var newKey = node.key - aggregateDelta; // (the keys are negated!)
        this._reprioritizeHeapNode(node, newKey);
      }
    },

    /**
     * Helper to decide whether to use decreaseKey for a node or remove it and
     * re-add it.  Centralized because this seems easy to screw up.  All values
     * are in the key-space, which is just the negated priority.
     */
    _reprioritizeHeapNode: function (node, newKey) {
      var prioritizedTasks = this._prioritizedTasks;
      if (newKey < node.key) {
        prioritizedTasks.decreaseKey(node, newKey);
      } else if (newKey > node.key) {
        var taskThing = node.value;
        prioritizedTasks.delete(node);
        prioritizedTasks.insert(newKey, taskThing);
      } // we intentionally do nothing for a delta of 0
    },

    /**
     * Prioritize the task for execution in our priority-heap.  Note that this
     * the `TaskManager` does not call us directly; it calls `TaskResources`
     * which then calls us.
     *
     * @param {WrappedTask|TaskMarker} taskThing
     */
    prioritizeTaskThing: function (taskThing /*, sourceId */) {
      // WrappedTasks store the type on the plannedTask; TaskMarkers store it on
      // the root (they're simple/flat).
      var isMarker = !!taskThing.type;
      var priorityTags = isMarker ? taskThing.priorityTags : taskThing.plannedTask.priorityTags;
      var relPriority = (isMarker ? taskThing.relPriority : taskThing.plannedTask.relPriority) || 0;
      var priority = relPriority + this._computePriorityForTags(priorityTags);
      // it's a minheap, we negate keys
      var nodeKey = -priority;

      // -- The task may already exist.
      var priorityNode = this._taskIdToHeapNode.get(taskThing.id);
      if (priorityNode) {
        this._reprioritizeHeapNode(priorityNode, nodeKey);
        // Priorities may have changed, so remove the existing mappings
        var oldTaskThing = priorityNode.value;
        this._cleanupTaskPriorityTracking(oldTaskThing);
        // The task/marker will have been created from scratch, so we need to
        // update the actual value.
        priorityNode.value = taskThing;
      } else {
        priorityNode = this._prioritizedTasks.insert(nodeKey, taskThing);
        this._taskIdToHeapNode.set(taskThing.id, priorityNode);
      }
      // And establish the new priority tag mappings.
      this._setupTaskPriorityTracking(taskThing, priorityNode);
    },

    /**
     * Helper for prioritizeTaskThing to add _priorityTagToHeapNodes mappings.
     */
    _setupTaskPriorityTracking: function (taskThing, priorityNode) {
      var isTask = !taskThing.type;
      var priorityTags = isTask ? taskThing.plannedTask.priorityTags : taskThing.priorityTags;
      var priorityTagToHeapNodes = this._priorityTagToHeapNodes;
      if (priorityTags) {
        for (var priorityTag of priorityTags) {
          var nodes = priorityTagToHeapNodes.get(priorityTag);
          if (nodes) {
            nodes.push(priorityNode);
          } else {
            priorityTagToHeapNodes.set(priorityTag, [priorityNode]);
          }
        }
      }
    },

    /**
     * Shared logic for prioritizeTaskThing and removeTaskThing to remove
     * _priorityTagToHeapNodes mappings.
     */
    _cleanupTaskPriorityTracking: function (taskThing, priorityNode) {
      var isTask = !taskThing.type;
      var priorityTags = isTask ? taskThing.plannedTask.priorityTags : taskThing.priorityTags;

      var priorityTagToHeapNodes = this._priorityTagToHeapNodes;
      if (priorityTags) {
        for (var priorityTag of priorityTags) {
          var nodes = priorityTagToHeapNodes.get(priorityTag);
          if (nodes) {
            var idx = nodes.indexOf(priorityNode);
            if (idx !== -1) {
              nodes.splice(idx, 1);
            }
            if (nodes.length === 0) {
              priorityTagToHeapNodes.delete(priorityTag);
            }
          }
        }
      }
    },

    /**
     * Remove the TaskThing with the given id.
     *
     * @param {TaskId} taskId
     * @param {PriorityNode} [priorityNode]
     *   Priority node, to be provided if available, or automatically retrieved if
     *   not.
     */
    removeTaskThing: function (taskId, priorityNode) {
      if (!priorityNode) {
        priorityNode = this._taskIdToHeapNode.get(taskId);
      }
      if (priorityNode) {
        var taskThing = priorityNode.value;
        this._prioritizedTasks.delete(priorityNode);
        this._taskIdToHeapNode.delete(taskId);
        this._cleanupTaskPriorityTracking(taskThing, priorityNode);
      }
    },

    /**
     * Iterate over all taskThings known to us, invoking `shouldRemove` on each
     * taskThing and removing it if the function returns true.  Note that this is
     * the opposite behaviour of Array.filter functions.
     *
     * This is an O(n) traversal which has been deemed acceptable for the
     * following use-cases, but for new purposes, please consider whether
     * additional data structures are merited for your use-case or not:
     * - TaskResources.resourceNoLongerAvailable moving tasks to be blocking when
     *   a resource is revoked.
     * - TODO: Removing outstanding tasks by accountId when an account is deleted.
     */
    removeTasksUsingFilter: function (shouldRemove) {
      for (var priorityNode of this._taskIdToHeapNode.values()) {
        const taskThing = priorityNode.value;
        if (shouldRemove(taskThing)) {
          this.removeTaskThing(taskThing.id, priorityNode);
        }
      }
    }
  };
  return TaskPriorities;
});
