'use strict';
define(function() {

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
  return function renderToDom() {
    //todo: how to do things like data-event? need to only bind once.
    var taggedFn = htemplate.makeTagged();
    renderFn.call(this, taggedFn, esc);
    var innerHtml = taggedFn();
    this.innerHTML = innerHtml;
  };
}

htemplate.esc = esc;

htemplate.makeTagged = function() {
  var parts = [];

  return function htagged(strings, ...values) {
    // If no strings passed, the return the results.
    if (!strings) {
      return parts.join('');
    }

    strings.forEach(function(str, i) {
      parts.push(str);
      if (i < values.length) {
        var value = values[i];
        if (value instanceof EscapedValue) {
          parts.push(value.escapedValue);
        } else {
          parts.push(esc(value));
        }
      }
    });
  };
};

return htemplate;

});
