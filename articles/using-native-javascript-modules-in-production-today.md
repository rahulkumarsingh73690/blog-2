
Two years ago [I wrote about a technique](https://philipwalton.com/articles/deploying-es2015-code-in-production-today/)&mdash;now commonly referred to as the module/nomodule pattern&mdash;that allows you to write ES2015+ JavaScript and then use bundlers and transpilers to generate two versions of your codebase, one with modern syntax (loaded via `<script type="module">`) and one with ES5 syntax (loaded via `<script nomodule>`). The technique allows you to ship significantly less code to module-supporting browsers, and it's now supported by most web frameworks and CLIs.

But back then, even with the ability to deploy modern JavaScript in production, and even though most browsers supported modules, I still recommended bundling your code.

Why? Mainly because I had the impression that loading modules in the browser was slow. Even though newer protocols like HTTP/2 theoretically support loading lots of small files efficiently, all the performance research at the time concluded that [using bundlers was still more efficient](https://v8.dev/features/modules#bundle).

But the truth is that research was incomplete. The module test example it studied consisted of unoptimized and unminified source files deployed to production. It didn't compare an *optimized* module bundle with an *optimized* classic script.

To be fair though, at the time, there wasn't really an optimized way to deploy modules. But now, thanks to some recent advances in bundler technology, it's possible to deploy your production code as ES2015 modules&mdash;with both static and dynamic imports&mdash;and get better performance than all non-module options currently available. In fact, this site has been using real modules in production for months.

## Misconceptions about modules

A lot of people I've talked to have completely written off modules as even an option for large-scale, production applications. Many of them cite the very research I just mentioned, where they [recommended *against* using modules](https://v8.dev/features/modules#bundle) in production unless it's for:

> ...small web apps with less than 100 modules in total and with a relatively shallow dependency tree (i.e. a maximum depth less than 5).

And if you've ever looked inside your `node_modules` directory, you probably know just how easy it is for even small apps to have over 100 module dependencies. I mean, consider how many modules are in some of the more popular utility packages on npm:

<table>
  <tr>
    <th>Package</td>
    <th>Module count</td>
  </tr>
  <tr>
    <td><a href="https://www.npmjs.com/package/date-fns">date-fns</a></td>
    <td>729</td>
  </tr>
  <tr>
    <td><a href="https://www.npmjs.com/package/lodash-es">lodash-es</a></td>
    <td>643</td>
  </tr>
  <tr>
    <td><a href="https://www.npmjs.com/package/rxjs">rxjs</a></td>
    <td>226</td>
  </tr>
</table>

But this is where the main misconception around modules lies. People assume that when it comes to using modules in production, your choices are either: (1) deploying all your source code as-is (including your `node_modules` directory), or (2) not using modules at all.

However, if you look closely at the recommendation from the research I cited, it doesn't say that loading modules is slower than loading regular scripts, and it doesn't say you shouldn't use modules _at all_, it just says that if you deploy hundreds of unminified module files to production, then Chrome won't be able to load them as fast as it can load a single, minified bundle. So the advice was to keep using bundlers, compilers, and minifiers.

But guess what? **You can do all of that and still use modules in production!**

In fact, modules is the format we all *should* be bundling to because browsers already know how to load modules (and the browsers that don't can use the `nomodule` fallback). If you inspect the output code generated by most popular bundlers, you'll find a lot of boilerplate whose only purpose is to dynamically load other code and manage dependencies, but none of that would be needed if we just used modules with `import` and `export` statements!

Fortunately, at least one popular bundler today ([Rollup](https://rollupjs.org)) supports [modules as an output format](https://rollupjs.org/guide/en/#outputformat), which means it's possible to both bundle your code *and* deploy modules in production (without all the loader boilerplate). And since Rollup has fantastic tree-shaking (the best of any bundler in my experience), bundling to modules with Rollup produces the smallest final code size of any option currently available.

{% Callout 'info' %}
**Update:** Parcel [plans to add module support](https://twitter.com/devongovett/status/1163792519764877312) in the next version. Webpack does not currently support a module output format, but here are a few issues to follow the discussion ([#2933](https://github.com/webpack/webpack/issues/2933), [#8895](https://github.com/webpack/webpack/issues/8895), [#8896](https://github.com/webpack/webpack/issues/8896)).
{% endCallout %}

Another misconception is that you can't use modules unless 100% of your dependencies use modules, and unfortunately (very unfortunate in my opinion), most npm packages are still published as CommonJS (some actually even author as ES2015 but then transpile to CommonJS before publishing to npm)!

Again, though, Rollup has a plugin ([rollup-plugin-commonjs](https://github.com/rollup/rollup-plugin-commonjs)) that can actually consume CommonJS source code and convert it to ES2015. While it's definitely [*better*](https://rollupjs.org/guide/en/#why-are-es-modules-better-than-commonjs-modules) if your dependencies are in ES2015 module format to begin with, having a few that aren't definitely does not prevent you from deploying modules.

In the rest of this post I'm going to show you how I bundle to modules (including the use of dynamic import and granular code splitting), explain why it's usually more performant than classic scripts, and show how I handle browsers that don't support modules.

## Optimal bundling strategy

Bundling code for production has always been about balancing trade-offs. On the one hand you want your code to load and execute as quickly as possible, but on the other hand you don't want to load code that users won't actually use.

You also want to make sure that your code is as cacheable as possible. A big problem with bundling is that any changes made to even just a single line of code invalidate the entire bundle. If you deploy your app with thousands of small modules (exactly as they are in your source code), then you can freely make small changes while still keeping most of your app's code in the cache&mdash;but like I already pointed out, that probably also means that your code takes longer to load for new visitors.

So the challenge is to find the right bundling granularity&mdash;the right balance between load performance and long-term cacheability.

Most bundlers, by default, code-split on dynamic import, but I'd argue that code-splitting on dynamic import alone is not granular enough, especially for sites with lots of returning users (where caching is important).

In my opinion, you should code-split as granularly as you can until it starts measurably affecting load performance. And while I definitely recommend doing your own analysis, as a ballpark the research I referenced above found no noticeable performance difference when loading fewer than 100 modules. Separate [research on HTTP/2 performance](https://medium.com/@asyncmax/the-right-way-to-bundle-your-assets-for-faster-sites-over-http-2-437c37efe3ff) found no noticeable difference when loading fewer than 50 files (though they only tested 1, 6, 50, and 1000, so 100 may have been fine).

So what's the best way to code-split aggressively, but not too aggressively? In addition to code-splitting via dynamic imports, I suggest also code-splitting by npm package&mdash;where each imported node modules get put into a chunk based on its package's name.

### Code-splitting at the package level

I mentioned above that some recent advances in bundler technology make performant module deployment possible. The advances I was talking about are two new Rollup features: [automatic code splitting](https://rollupjs.org/guide/en/#code-splitting) via dynamic `import()` (added in [v1.0.0](https://github.com/rollup/rollup/releases/tag/v1.0.0)) and [programmatic, manual code splitting](https://rollupjs.org/guide/en/#manualchunks) via the `manualChunks` option (added in [v1.11.0](https://github.com/rollup/rollup/releases/tag/v1.11.0)).

With these two features it's now quite easy to configure a build that code-splits at the package level.

Here's an example config that uses the `manualChunks` option to put each imported node module into a chunk that matches its package name (well, technically, its directory name inside `node_modules`).

```js
export default {
  input: {
    main: 'src/main.mjs',
  },
  output: {
    dir: 'build',
    format: 'esm',
    entryFileNames: '[name].[hash].mjs',
  },
  manualChunks(id) {
    if (id.includes('node_modules')) {
      // Return the directory name following the last `node_modules`.
      // Usually this is the package, but it could also be the scope.
      **const dirs = id.split(path.sep);**
      **return dirs[dirs.lastIndexOf('node_modules') + 1];**
    }
  },
}
```

The `manualChunks` option accepts a function that takes a module file path as its only argument. That function can return a string name, and whatever name it returns will be the chunk the given module gets added to. If nothing is returned, the module will be added to the default chunk.

Consider an app that imports the `cloneDeep()`, `debounce()`, and `find()` modules from the `lodash-es` package. The above configuration would put each of those modules (as well as any other lodash modules *they* import) into a single output file with a name like `npm.lodash-es.XXXX.mjs` (where XXXX is a unique file hash of just the modules in the `lodash-es` chunk).

At the end of that file you'd see export statements like this (notice that it contains only the export statements for the modules added to the chunk, not _all_ lodash modules):

```js
export {cloneDeep, debounce, find};
```

Then, if code in any of the other chunks uses those lodash modules (perhaps just the `debounce()` method), that chunk would have an import statement at the top that looks like this:

```js
import {debounce} from './npm.lodash.XXXX.mjs';
```

Hopefully this example makes it clear how manual code splitting with Rollup works. And, on a personal note, I think code splitting that uses `import` and `export` statements is _far_ easier to read and understand than code splitting that uses a non-standard, bundler-specific implementation.

For example, it's very hard to follow what's happening in this file (actual output from one of my older projects using webpack's code splitting), and almost none of this code is needed in module-supporting browsers:

```js:no-mark
(window["webpackJsonp"] = window["webpackJsonp"] || []).push([["import1"],{

/***/ "tLzr":
/*!*********************************!*\
  !*** ./app/scripts/import-1.js ***!
  \*********************************/
/*! exports provided: import1 */
/***/ (function(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export (binding) */ __webpack_require__.d(__webpack_exports__, "import1", function() { return import1; });
/* harmony import */ var _dep_1__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./dep-1 */ "6xPP");

const import1 = "imported: " + _dep_1__WEBPACK_IMPORTED_MODULE_0__["dep1"];

/***/ })

}]);
```

#### What if you have hundreds of npm dependencies?

I claimed above that I think code-splitting at the package level usually puts you into the sweet spot of code-splitting aggressively but not too aggressively.

Of course, if your application imports modules from hundreds of different npm packages, you may still be in a situation where the browser can't load them all efficiently.

However, if you do have lots of npm dependencies, don't abandon this strategy quite yet. Keep in mind that you're likely not loading *all* of your npm dependencies on every page, so it's important to check and see just how many dependencies you actually do load.

Still, I'm sure there are some really large applications that do have so many npm dependencies that they can't realistically code-split on every single one of them. If this applies to you, I'd recommend figuring out a way to group some of your dependencies into common chunks. In general you'd want to group packages that are likely to have code changes at similar times (e.g. `react`and `react-dom`) since they'll have to be invalidated together (e.g. the example app I show later groups all React dependencies [into the same chunk](https://github.com/philipwalton/rollup-native-modules-boilerplate/blob/da5e616c24d554dd8ffe562a7436709106be9eed/rollup.config.js#L159-L162)).

## Dynamic import

One downside of using real import statements for code splitting and module loading is that it's up to you (as the developer) to handle browsers that don't support modules.

And if you want to use dynamic `import()` to lazy load code, then you have to *also* deal with the fact that some browsers [do support modules](https://caniuse.com/#feat=es6-module) yet [don't support dynamic `import()`](https://caniuse.com/#feat=es6-module-dynamic-import) (Edge 16–18, Firefox 60–66, Safari 11, Chrome 61–63).

Fortunately, a tiny (~400 bytes), very performant [polyfill](https://github.com/GoogleChromeLabs/dynamic-import-polyfill) is available for dynamic import.

Adding the polyfill to your site is easy. All you have to do is import it and initialize it in your app's main entry point (before calling `import()` anywhere):

```js
import dynamicImportPolyfill from 'dynamic-import-polyfill';

// This needs to be done before any dynamic imports are used. And if your
// modules are hosted in a sub-directory, the path must be specified here.
dynamicImportPolyfill.initialize({modulePath: '/modules/'});
```

The last thing you need to do for this to work is to tell Rollup to rename dynamic `import()` in your output code to another name of your choosing (via the [`output.dynamicImportFunction`](https://rollupjs.org/guide/en/#outputdynamicimportfunction) option). The dynamic import polyfill defaults to using the name `__import__`, but [that can be configured](https://github.com/GoogleChromeLabs/dynamic-import-polyfill#configuration-options).

The reason it's necessary to rename `import()` statements is because `import` is a keyword in JavaScript. That means it's not possible to polyfill native `import()` with the same name because trying to do so would result in a syntax error.

But having Rollup rename it at built time is actually great because it means your source code can use the standard version&mdash;and in the future when the polyfill is no longer needed, you won't have to change it back.

## Loading JavaScript modules efficiently

Anytime you use code splitting it's a good idea to also preload all the modules you know are going to be loaded right away (i.e. all the modules in your main entry module's import graph).

But when you're loading actual JavaScript modules (via `<script type="module">` and then subsequently `import` statements) you'll want to use [`modulepreload`](https://developers.google.com/web/updates/2017/12/modulepreload) instead of traditional [`preload`](https://developer.mozilla.org/en-US/docs/Web/HTML/Preloading_content) (which is intended only for classic scripts).

```html
<link rel="modulepreload" href="/modules/main.XXXX.mjs">
<link rel="modulepreload" href="/modules/npm.pkg-one.XXXX.mjs">
<link rel="modulepreload" href="/modules/npm.pkg-two.XXXX.mjs">
<link rel="modulepreload" href="/modules/npm.pkg-three.XXXX.mjs">
<!-- ... -->
<script type="module" src="/modules/main.XXXX.mjs"></script>
```

In fact, `modulepreload` is actually strictly better than traditional `preload` for preloading real modules because it doesn't just download the file, it also starts parsing and compiling it immediately, off the main thread. Traditional preload can't do this because it doesn't know at preload time if the file will be used as a module script or classic script.

That means modules load via `modulepreload` will often load faster and are less likely to cause main-thread jank when being instantiated.

### Generating the `modulepreload` list

All entry chunks in Rollup's [bundle](https://rollupjs.org/guide/en/#generatebundle) object contain a full list of imports in their static dependency graphs, so it's easy to get the list of what files need to be preloaded in Rollup's [`generateBundle` hook](https://rollupjs.org/guide/en/#generatebundle).

While some `modulepreload` plugins do exist on npm, generating a `modulepreload` list for every entry point in your graph requires only a few lines of code, so I prefer to just create it manually like this:
```js
{
  generateBundle(options, bundle) {
    // A mapping of entry chunk names to their full dependency list.
    const modulepreloadMap = {};

    for (const [fileName, chunkInfo] of Object.entries(bundle)) {
      if (chunkInfo.isEntry || chunkInfo.isDynamicEntry) {
        modulepreloadMap[chunkInfo.name] = [fileName, ...chunkInfo.imports];
      }
    }

    // Do something with the mapping...
    console.log(modulepreloadMap);
  }
}
```
For example, here's [how I generate the `modulepreload` list](https://github.com/philipwalton/blog/blob/90e914731c77296dccf2ed315599326c6014a080/tasks/javascript.js#L18-L43) for this site as well as [for my demo app](https://github.com/philipwalton/rollup-native-modules-boilerplate/blob/78c687bf757374b5e685508e3afc9560a86a3c96/rollup.config.js#L57-L84) (introduced below).


{% Callout 'info' %}
**Note:** while `modulepreload` is definitely better than classic `preload` for module scripts, it does have worse browser support (it's Chrome-only at the moment). If a sizable portion of your traffic is non-Chrome traffic, it may make sense to use classic preload instead.

One caution when using preload though is that, unlike `modulepreload`, `preload`-ed scripts don't get put in the browser's module map, which means it's possible that a `preload`-ed request gets processed more than once (e.g. if a module imports the file before the browser is done preloading it).
{% endCallout %}

## Why deploy real modules?

If you're already using a bundler like [webpack](https://webpack.js.org/), and you're already using granular code splitting and preloading those files (similar to what I describe here), you might be wondering whether it's worth switching to a strategy that uses real modules. Here are a few reasons why I think you should consider it, and why bundling to real modules is better than using classic scripts with their own module-loading code.

#### Smaller total code footprint

When using real modules, users on modern browsers don't have to load any unnecessary module loading or dependency management code. For example the [webpack runtime and manifest](https://webpack.js.org/concepts/manifest/) would not be needed at all if using real modules.

#### Better preloading

As I mentioned in the previous section, using `modulepreload` allows you to load code and parse/compile it off the main thread. All other things being equal, this means your pages will get interactive faster, and the main thread is less likely to be blocked during user interaction.

So regardless of how granularly you code-split your app, it's more performant to load chunks using import statements and `modulepreload` than it is to load them via classic script tags and regular preload (especially if those tags are dynamically generated and added to the DOM at runtime).

In other words, a Rollup bundle consisting of 20 module chunks will load faster than the same code base bundled to 20 classic-script chunks with webpack (not because it's webpack, but because it's not real modules).

#### More future-friendly

A lot of the most exciting new browser features are built on top of modules, not classic scripts. That means if you want to use any of these features, your code needs to be deployed as real modules, not transpiled to ES5 and loaded via classic script tags (a problem I wrote about while trying to use the experimental [KV Storage API](https://developers.google.com/web/updates/2019/03/kv-storage)).

Here are a few of the most exciting new features that are module-only:

* [Built-in modules](https://github.com/tc39/proposal-javascript-standard-library/)
* [HTML Modules](https://github.com/w3c/webcomponents/blob/gh-pages/proposals/html-modules-explainer.md)
* [CSS Modules](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/master/CSSModules/v1Explainer.md)
* [JSON Modules](https://github.com/whatwg/html/pull/4407)
* [Import Maps](https://github.com/WICG/import-maps)
* [Sharing modules between workers, service workers, and the window](https://html.spec.whatwg.org/multipage/workers.html#module-worker-example)

## Supporting legacy browsers

Globally [more than 83% of browsers](https://google.github.io/styleguide/jsguide.html) natively support JavaScript modules (including dynamic import), so for the vast majority of your users, nothing special needs to be done to make this technique work.

For browsers that support modules but don't support dynamic import, you can use the [`dynamic-import-polyfill`](https://github.com/GoogleChromeLabs/dynamic-import-polyfill) I referenced above. Since the polyfill is very small and will use the browser's native dynamic `import()` when available, adding this polyfill has almost no size or performance cost.

For browsers that don't support modules at all, you can use the `module/nomodule` technique [I wrote about previously](https://philipwalton.com/articles/deploying-es2015-code-in-production-today/).

### A working example

Since it's always easier to talk about cross-browser compatibility than it is to actually make it work, I've built [a demo app](https://rollup-native-modules-boilerplate.glitch.me/) that uses all the techniques I outlined here.

<figure>
  <a href="https://rollup-native-modules-boilerplate.glitch.me/">
    <img srcset="
      {{ 'native-javascript-modules-demo-1400w.png' | revision }},
      {{ 'native-javascript-modules-demo.png' | revision }} 700w"
      src="{{ 'native-javascript-modules-demo.png' | revision }}"
      alt="A demo app showing how to use native JavaScript modules with legacy browser support">
  </a>
</figure>

The demo works in browsers that don't support dynamic `import()` (like Edge 18 and Firefox ESR), and it also works in browsers that don't support modules (like Internet Explorer 11).

And to show that this strategy doesn't just work for simple use cases, I've included a lot of features today's complex JavaScript applications require:

* Babel transforms (including JSX)
* CommonJS dependencies (e.g. `react`, `react-dom`)
* CSS dependencies
* Asset hashing
* Code splitting
* Dynamic import (w/ polyfill fallback)
* module/nomodule fallback

The code is [hosted on GitHub](https://github.com/philipwalton/rollup-native-modules-boilerplate) (so you can fork the repo and build it yourself), and the demo is [hosted on Glitch](https://glitch.com/edit/#!/rollup-native-modules-boilerplate), so you can remix it and play around with the features.

The most important thing to look at is the [Rollup configuration used in the example](https://github.com/philipwalton/rollup-native-modules-boilerplate/blob/master/rollup.config.js), as that defines how the final modules are generated.

## Wrapping up

Hopefully this post has convinced you that not only is it possible to deploy native JavaScript modules in production today, but that doing so can actually improve the load and runtime performance of your site.

Here's a quick summary of the steps needed to make this work:

* Use a bundler, but make sure your output format is ES2015 modules
* Code-split aggressively (all the way down to the node package if possible)
* Preload all the modules in your static dependency graph (via `modulepreload`)
* Use a polyfill to support browsers that don't support dynamic `import()`
* Use `<script nomodule>` to support browsers that don't support modules at all

If you already use Rollup in your build setup, I'd love for you to try the technique I outlined here and deploy real modules (with code splitting and dynamic imports) in production. And if you do, [let me know](https://twitter.com/philwalton) how it goes, because I'd love to hear both your issues and success stories!

Modules are the clear future for JavaScript, and I'd like to see all our tooling and dependencies embrace modules as quickly as possible. Hopefully this article can be a small nudge in that direction.
