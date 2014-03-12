/*global performance */
'use strict';

/*
TODO: a reset method for when folders are switched
 */

define(function(require, exports, module) {

  var slice = Array.prototype.slice,
      nodeCacheIdCounter = 0,
      usePerfLog = module.config().usePerfLog || false,
      // 16 ms threshold for 60 fps, should be lower though
      perfThreshold = module.config().perfThreshold || 16;

  var logQueue = [],
      logTimeoutId = 0;

  function logPerf() {
    logQueue.forEach(function(msg) {
      console.log(msg);
    });
    logQueue = [];
    logTimeoutId = 0;
  }

  function queueLog(prop, time) {
    logQueue.push(module.id + ': ' + prop + ': ' + time);
    if (!logTimeoutId) {
      logTimeoutId = setTimeout(logPerf, 2000);
    }
  }

  function perfWrap(prop, fn) {
    return function() {
      var start = performance.now();
      var result = fn.apply(this, arguments);
      var end = performance.now();

      var time = end - start;
      if (time > perfThreshold) {
        queueLog(prop, end - start);
      }
      return result;
    };
  }


  function setTop(node, value, useTransform) {
    if (useTransform) {
      node.style.transform = 'translateY(' + value + 'px)';
    } else {
      node.style.top = value + 'px';
    }
  }

  function NodeCache(useTransform) {
    this.container = new VScroll.NodeCache.Node();
    this.id = nodeCacheIdCounter++;
    this.container.dataset.cacheid = this.id;
    this.nodes = [];
    this.useTransform = useTransform;

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
      setTop(this.container, top, this.useTransform);
      this.topPx = top;
    }
  };

  function VScroll(container, scrollingContainer, list, template, defaultData) {
    this.container = container;
    this.scrollingContainer = scrollingContainer;
    this.list = list;
    this.template = template;
    this.defaultData = defaultData;

    this.currentIndex = 0;

    this._limited = false;

    // Stores the list of DOM nodes to reuse.
    this.nodeCacheList = [];
    this.nodeCacheId = 0;

    this.prevScrollTop = 0;

    // Bind to this to make reuse in functional APIs easier.
    this.onEvent = this.onEvent.bind(this);
    this.onChange = this.onChange.bind(this);
  }

  VScroll.NodeCache = NodeCache;

  VScroll.prototype = {
    // rate limit for event handler, in milliseconds, so that
    // it does not do work for every event received. If set to
    // zero, it means always do the work for every scroll event.
    // Setting to a value though does not help, ends up with
    // white scrolling.
    eventRateLimit: 0,

    // How much to multiply the visible node range by to allow for
    // smoother scrolling transitions without white gaps.
    rangeMultipler: 2,

    // What fraction of the height to use to trigger the render of
    // the next node cache
    heightFractionTrigger: 8 / 10,

    // Detach cache dom when doing item updates and reattach when done
    detachForUpdates: false,

    // number of NodeCache objects to use
    nodeCacheListSize: 3,

    // Use transformY instead of top to position node caches.
    useTransform: false,

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

    // Handles events fired, but only limits actual work, in
    // onChange, to be done on a rate-limited value.
    onEvent: function() {
      if (!this.eventRateLimit) {
        return this.onChange();
      }

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
          topDistance = scrollTop - cache.topPx,
          bottomDistance = (cache.topPx + this.cacheContainerHeight) -
                            scrollTop,
          scrollDown = scrollTop >= this.prevScrollTop;

      // If topDistance is past the triggerHeight, send out an event
      // about needing more data, in the appropriate direction.

      if (scrollDown && (topDistance > 0 &&
          topDistance > this.cacheTriggerHeight)) {
        startDataIndex = cache.dataIndex + this.nodeRange;

        // Render next cache segment but only if not already at the end.
        if (startDataIndex < this.list.size()) {
          // Do not ask for data past the size of the data list.
          var totalCount = this.list.size();
          var count = this.nodeRange;
          if (startDataIndex + count > totalCount) {
            count = totalCount - startDataIndex;
          }
          this.onNeedData(startDataIndex, count);

          this._render(startDataIndex);
        }
      } else if (!scrollDown && (bottomDistance > 0 &&
                 bottomDistance > this.cacheTriggerHeight)) {
        startDataIndex = cache.dataIndex - this.nodeRange;
        if (startDataIndex < 0) {
          startDataIndex = 0;
        }

        // Render next segment but only if not already at the top.
        if (startDataIndex !== 0 || cache.topPx !== 0) {
          this.onNeedData(startDataIndex, this.nodeRange);
          this._render(startDataIndex);
        }
      }
      this.prevScrollTop = scrollTop;
    },

    onNeedData: function() {},

    // can return null, the index could be more than
    // what is in that segment
    getNodeForListIndex: function(index) {
      var cache = this.currentNodeCache,
          nodes = cache.nodes;
      index -= cache.startIndex;

      return nodes[index];
    },

    _render: function(index) {
      var i,
          startIndex = index;

      this.currentIndex = index;

      if (!this._inited) {
        this._init(index);
        startIndex += 1;
      } else {
        // Disregard the render request an existing cache set already has
        // that index generated.
        for (i = 0; i < this.nodeCacheList.length; i++) {
          if (i !== this.nodeCacheId &&
              this.nodeCacheList[i].dataIndex === index) {
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
      this.currentNodeCache.startIndex = this.currentIndex;

      // Pull the node cache container out of the DOM to
      // allow for the updates to happen quicker without
      // triggering reflows in the middle.
      if (this.detachForUpdates) {
        this.container.removeChild(cache.container);
      }

      var length = index + nodes.length;
      for (i = startIndex; i < length; i++) {
        var node = nodes[i - index];
        if (i < this.list.size()) {
          var data = this.list(i) || this.defaultData;
          this._dataBind(data, node, i * this.itemHeight);
        }
      }

      // Reposition the cache at the new location and insert
      // back into the DOM
      cache.setTop(index * this.itemHeight);
      if (this.detachForUpdates) {
        this.container.appendChild(cache.container);
      }
    },

    _init: function(index) {
      for (var i = 0; i < this.nodeCacheListSize; i++) {
        this.nodeCacheList.push(new NodeCache(this.useTransform));
      }

      // Render the data item at index, to get sizes of things,
      // and create the cache of nodes.
      var node = this.template.cloneNode(true),
          cache = this.nodeCacheList[0];

      cache.nodes.push(node);

      this._dataBind(this.list(index) || this.defaultData, node, 0);

      cache.container.appendChild(node);
      cache.setTop(0);
      this.container.appendChild(cache.container);

      this.itemHeight = node.clientHeight;
      this.totalHeight = this.itemHeight * this.list.size();
      // Using window here because asking for this.container.clientHeight
      // will be zero since it has not children that are in the flow.
      // innerHeight is fairly close though as the list content is the
      // majority of the display area.
      this.itemsPerDisplay = Math.ceil(window.innerHeight /
                                       this.itemHeight);
      this.nodeRange = Math.floor(this.itemsPerDisplay * this.rangeMultipler);
      this.cacheContainerHeight = this.nodeRange * this.itemHeight;

      this.cacheTriggerHeight = this.cacheContainerHeight -
                                (this.cacheContainerHeight *
                                 this.heightFractionTrigger);
      this.cacheHalfHeight = this.cacheContainerHeight / 2;

      if (index > 0) {
        setTop(node, (index * this.itemHeight), this.useTransform);
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
          setTop(newNode, (i * this.itemHeight), this.useTransform);
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
    },

    _dataBind: function(model, node, top) {
      slice.call(node.querySelectorAll('[data-bind]')).forEach(function(node) {
        var prop = node.dataset.bind;
        node.innerHTML = model[prop] || '';
      });
    }
  };

  if (usePerfLog) {
    Object.keys(VScroll.prototype).forEach(function (prop) {
      var proto = VScroll.prototype;
      if (typeof proto[prop] === 'function') {
        proto[prop] = perfWrap(prop, proto[prop]);
      }
    });
  }

  return VScroll;
});
