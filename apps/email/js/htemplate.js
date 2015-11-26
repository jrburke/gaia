'use strict';
define(function() {

var idCounter = 0,
    fnRegExp = / data-hfn-(\w+)="$/;

// Keep this constructor private, do not expose it directly to require creation
// of instances via the esc API.
function EscapedValue(value) {
  this.escapedValue = value;
}

// Functions to properly escape string contents. Default one escapes HTML.
function esc(value) {
  return value.replace(/&/g, '&amp;')
              .replace(/=/g, '&eq;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
}

esc.html = function(value) {
  return new EscapedValue(esc(value));
};

esc.yesThisIsDangerousRaw = function(value) {
  return new EscapedValue(value);
};

function htemplate(renderFn) {
  var taggedFn = htemplate.makeTagged();

  return function renderToDom() {
    renderFn.call(this, taggedFn, esc);
    var tagResult = taggedFn();

    this.innerHTML = tagResult.text;

    var bindingId = tagResult.bindingId;
    if (bindingId) {
      [...this.querySelectorAll('[data-hbinding-' + bindingId + ']')]
      .forEach(function(node) {
        var fnId = node.dataset['hbinding-' + bindingId],
            binding = tagResult.bindings[fnId];

        if (!binding) {
          console.error('Cound not find binding ' + fnId);
          return;
        }

        if (binding.fn) {
          node[binding.fn](binding.value);
        }
      });
    }
  };
}

htemplate.esc = esc;

htemplate.makeTagged = function() {
  var dataId = (idCounter++),
      fnCounter = 0,
      parts = [],
      bindingId,
      bindings = {};

  return function htagged(strings, ...values) {
    // If no strings passed, the return the results.
    if (!strings) {
      var result = {
        bindingId,
        bindings,
        text: parts.join('')
      };
      fnCounter = 0;
      parts = [];
      bindingId = undefined;
      bindings = {};

      return result;
    }

    strings.forEach(function(str, i) {

      var value;
      if (i < values.length) {
        value = values[i];
        if (value instanceof EscapedValue) {
          value = value.escapedValue;
        } else if (typeof value !== 'string') {
          // Check for data-hfn-functionname=" as the end of the previous
          // string, if so it is a binding to a function call.
          var match = fnRegExp.exec(str);
          if (match) {
            bindingId = dataId;
            var fnId = 'id' + (fnCounter++);
            bindings[fnId] = {
              value,
              fn: match[1]
            };

            value = fnId;

            // Swap out the attribute name to be specific to this htagged ID,
            // to make query selection faster and only targeted to this htagged.
            str = str.substring(0, match.index) + ' data-hbinding-' +
                  bindingId + '="';
          }
        }
      }

      parts.push(str);

      if (value) {
        if (typeof value !== 'string') {
          value = String(value);
        }
        parts.push(esc(value));
      }
    });
  };
};

return htemplate;

});
