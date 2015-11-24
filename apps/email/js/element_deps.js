/*global module */
(function(factory) {
  'use strict';
  // Use a UMD wrapper so the module can be used in the build environment.
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(['require', 'exports', 'module'], factory);
  } else if (typeof module === 'object' && typeof exports === 'object') {
    // CommonJS
    module.exports = factory();
  }
}(function(require, exports, module) {
'use strict';

var htmlCommentRegExp = /<!--*.?-->/g,
    jsCommentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
    defineRegExp = /define\s*\s*\(function\s*\s*\(require[^\{]+{/,
    depPrefix = 'element!',
    htmlTemplateStringRegExp = /html`/,
    moduleConfig = (module && module.config()) || {},
    tagRegExp = /<(\w+-[\w-]+)(\s|>)/g,
    tagToId = function(tag) { return tag; },
    useStatementRegExp = /['"]use [^'"]+['"]/g;

if (moduleConfig.hasOwnProperty('tagToId')) {
  tagToId = moduleConfig.tagToId;
}

function depsToRequire(deps) {
  return deps.map(function(dep) {
    return 'require(\'' + dep + '\')';
  }).join(';\n');
}

function elementDeps(text) {
  var match, noCommentText,
      deps = [];

  // Remove comments so only legit tags are found
  noCommentText = text.replace(htmlCommentRegExp, '');

  tagRegExp.lastIndex = 0;
  while ((match = tagRegExp.exec(noCommentText))) {
    deps.push(depPrefix + elementDeps.tagToId(match[1]));
  }

  return deps;
}

elementDeps.tagToId = tagToId;

elementDeps.injectDepsInSource = function(text) {
  var noCommentText = elementDeps.removeJsComments(text);
  if (!htmlTemplateStringRegExp.test(noCommentText)) {
    return text;
  }

  var deps = elementDeps(noCommentText);
  if (!deps.length) {
    return text;
  }

  // Find the define() in the unmodified text. This means that this could fail
  // if the source has a commented out define() call above the real define.
  // However, this is unlikely, so going with simpler regexp over fanciness.
  var defMatch = defineRegExp.exec(text);
  if (!defMatch) {
    // Unexpected, but do not fail.
    console.error('elementDefs could not find define in: ' + text);
    return text;
  }
  var insertIndex = defMatch.index + defMatch[0].length;

  var modifiedText = text.substring(0, insertIndex);

  // This assumes any "use" statements fit inside 256 characters.
  var possibleUseString = text.substring(insertIndex, insertIndex + 256);
  var useMatch;
  var refIndex = 0;
  useStatementRegExp.lastIndex = 0;
  while ((useMatch = useStatementRegExp.exec(possibleUseString))) {
    if (useMatch.index < refIndex + 4) {
      refIndex = useMatch.index + useMatch[0].length;
    } else {
      // Not a top level use statement, could be another one inside a nested
      // function, skip further searching.
      break;
    }
  }

  if (refIndex > 0) {
    modifiedText += text.substring(insertIndex, insertIndex + refIndex);
    insertIndex += refIndex;
  }

  modifiedText += ';' + depsToRequire(deps);

  modifiedText += text.substring(insertIndex, text.length);

  return modifiedText;
};

elementDeps.removeJsComments = function(text) {
  return text.replace(jsCommentRegExp, '');
};

return elementDeps;

}));
