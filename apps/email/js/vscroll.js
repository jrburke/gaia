'use strict';

/*
TODO: a reset method for when folders are switched
 */

define(function(require) {

  var slice = Array.prototype.slice,
      nodeCacheIdCounter = 0;

  function NodeCache() {
    this.container = new VScroll.NodeCache.Node();
    this.id = nodeCacheIdCounter++;
    this.container.dataset.cacheid = this.id;
    this.nodes = [];

    // Used by VScroll to track position so DOM
    // does not have to be queried for it.
    this.topPx = 0;
  }

  NodeCache.Node = function () {
    var node = document.createElement('div');
    node.classList.add('vscroll-cachelist');
    return node;
  };

  NodeCache.prototype = {
    setTop: function(top) {
      this.container.style.top = top + 'px';
      this.topPx = top;
    }
  };

  function VScroll(container, scrollingContainer, list, template, defaultData) {
    this.container = container;
    this.scrollingContainer = scrollingContainer;
    this.list = list;
    this.template = template;
    this.defaultData = defaultData;
    this.size = this.list.length;

    this._limited = false;

    // Stores the list of DOM nodes to reuse.
    this.nodeCacheList = [
      new NodeCache(),
      new NodeCache(),
      new NodeCache()
    ];
    this.nodeCacheId = 0;

    // Bind to this to make reuse in functional APIs easier.
    this.onEvent = this.onEvent.bind(this);
    this.onChange = this.onChange.bind(this);
  }

  VScroll.NodeCache = NodeCache;

  VScroll.prototype = {
    activate: function(index) {
      // Populate the initial view
      this._render(index);
      this.scrollingContainer.addEventListener('scroll', this.onEvent);
      this.scrollingContainer.addEventListener('resize', this.onEvent);
    },

    deactivate: function() {
      this.scrollingContainer.removeEventListener('scroll', this.onEvent);
      this.scrollingContainer.removeEventListener('resize', this.onEvent);
    },

    // rate limit for event handler, in milliseconds, so that
    // it does not do work for every event received.
    eventRateLimit: 50,

    // How much to multiply the visible node range by to allow for
    // smoother scrolling transitions without white gaps.
    rangeMultipler: 3,

    // What fraction of the height to use to trigger the render of
    // the next node cache
    heightFractionTrigger: 1 / 2,

    // Handles events fired, but only limits actual work, in
    // onChange, to be done on a rate-limited value.
    onEvent: function() {
      if (this._limited) {
        return;
      }
      this._limited = true;
      setTimeout(this.onChange, this.eventRateLimit);
    },

    onChange: function() {
      // Rate limit is now expired since doing actual work.
      this._limited = false;

      var startDataIndex,
          cache = this.currentNodeCache,
          scrollTop = this.scrollingContainer.scrollTop,
          topDistance = scrollTop - cache.topPx;

      // If topDistance is less than half, trigger a "we need more data above"
      // event. If more than half, a d "we need more data below" event.
      // TODO

      // If less than a third in one of the directions, render the next
      // nodeCache. Otherwise, all it good, do not do anything.
      if (topDistance < this.cacheTriggerHeight) {
        startDataIndex = cache.dataIndex - this.nodeRange;
        if (startDataIndex < 0) {
          startDataIndex = 0;
        }

        // Render next segment but only if not already at the top.
        if (startDataIndex !== 0 || cache.topPx !== 0) {
          this._render(startDataIndex);
        }
      } else if (topDistance > this.cacheTriggerHeight) {
        startDataIndex = cache.dataIndex + this.nodeRange;

        // Render next cache segment but only if not already at the end.
        if (startDataIndex < this.list.length) {
          this._render(startDataIndex);
        }
      }
    },

    _render: function(index) {
      var i,
          startIndex = index;

      if (!this._inited) {
        this._init(index);
        startIndex += 1;
      } else {
        // Disregard the render request an existing cache set already has
        // that index generated.
        for (i = 0; i < this.nodeCacheList.length; i++) {
          if (this.nodeCacheList[i].dataIndex === index) {
            this.currentNodeCache = this.nodeCacheList[i];
            this.nodeCacheId = i;
            return;
          }
        }

        // Not the first render, update nodeCache to use.
        this.nodeCacheId += 1;
        if (this.nodeCacheId > this.nodeCacheList.length - 1) {
          this.nodeCacheId = 0;
        }
      }

      var cache = this.nodeCacheList[this.nodeCacheId],
          nodes = cache.nodes;

      cache.dataIndex = index;
      this.currentNodeCache = cache;

      // Pull the node cache container out of the DOM to
      // allow for the updates to happen quicker without
      // triggering reflows in the middle.
      //this.container.removeChild(cache.container);

      var length = index + nodes.length;
      for (i = startIndex; i < length; i++) {
        var node = nodes[i - index];
        if (i < this.list.length) {
          var data = this.list[i] || this.defaultData;
          this._dataBind(data, node, i * this.itemHeight);
        }
      }

      // Reposition the cache at the new location and insert
      // back into the DOM
      cache.setTop(index * this.itemHeight);
      //this.container.appendChild(cache.container);
    },

    _init: function(index) {
      // Render the data item at index, to get sizes of things,
      // and create the cache of nodes.
      var node = this.template.cloneNode(true),
          cache = this.nodeCacheList[0];

      cache.nodes.push(node);

      this._dataBind(this.list[index], node, 0);

      cache.container.appendChild(node);
      cache.setTop(0);
      this.container.appendChild(cache.container);

      this.itemHeight = node.clientHeight;
      this.totalHeight = this.itemHeight * this.size;
      // Using window here because asking for this.container.clientHeight
      // will be zero since it has not children that are in the flow.
      // innerHeight is fairly close though as the list content is the
      // majority of the display area.
      this.itemsPerDisplay = Math.ceil(window.innerHeight /
                                       this.itemHeight);
      this.nodeRange = Math.ceil(this.itemsPerDisplay * this.rangeMultipler);
      this.cacheContainerHeight = this.nodeRange * this.itemHeight;

      this.cacheTriggerHeight = this.cacheContainerHeight *
                              this.heightFractionTrigger;
      this.cacheHalfHeight = this.cacheContainerHeight / 2;

      if (index > 0) {
        node.style.top = (index * this.itemHeight) + 'px';
      }

      // Generate as set of DOM nodes to reuse.
      // The - 1 is because the init node used to calculate itemHeight
      // is already in the cache.
      this.nodeCacheList.forEach(function(cache, cacheIndex) {
        var nodes = cache.nodes,
            i = 0,
            length = this.nodeRange;

        // If the first pass through, already added test div to get
        // item height, so exclude that one from the count.
        if (cacheIndex === 0) {
          i = 1;
        }

        // Set explicit height on on the cache container, in the hopes
        // that this helps layout, but not proven yet.
        cache.container.style.height = this.cacheContainerHeight + 'px';
        cache.setTop(cacheIndex * this.cacheContainerHeight);

        if (cacheIndex > 0) {
          // The NodeCache container needs to be inserted into the DOM
          this.container.appendChild(cache.container);
        }

        // Set up the cache nodes inside the container.
        for (; i < length; i++) {
          var newNode = this.template.cloneNode(true);
          newNode.style.top = (i * this.itemHeight) + 'px';
          cache.container.appendChild(newNode);
          nodes.push(newNode);
        }
      }.bind(this));

      // Size the scrollable area to the full height if all items
      // were rendered inside of it, so that there is no weird
      // scroll bar grow/shrink effects and so that inertia
      // scrolling is not artificially truncated.
      this.container.style.height = this.totalHeight + 'px';

      this._inited = true;
console.log('INITED');
console.log(this);
    },

    _dataBind: function(model, node, top) {
      slice.call(node.querySelectorAll('[data-bind]')).forEach(function(node) {
        var prop = node.dataset.bind;
        node.innerHTML = model[prop] || '';
      });
    }
  };

  return VScroll;
});
