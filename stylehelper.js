/**
 * This is a pure-JS helper module to handle various style-related actions.
 * Though part of the fake input project, this lib could be used outside of this project.
 */

// https://github.com/umdjs/umd/blob/master/templates/returnExports.js
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD, Register as an anonymous module.
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but only CommonJS-like environments
        // that support module.exports, like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.StyleHelper = factory();
    }
}(this, function () {
    var inertSheet = null;

    return {

        /**
         * Creates a new <style> for the .inert class rules if not yet created.
         * (There was a talk to add a inert attribute in HTML5 but it is not implemented and the spec
         * is not working on it so much...)
         * @returns {Stylesheet} the stylesheet we injected .inert style on
         */
        getInertSheet: function () {
            var css, head, style;

            if (inertSheet === null) {
                css = '.inert {' +
                        /* position: absolute changes display to block.
                         We set display explicitly so that makeInert() can returns default display style too.
                         */
                        'position: absolute;' +
                        'display: block;' + /* could be anything actually */
                        'visibility: hidden;' +
                        'z-index: -1;' +
                        '-webkit-user-select: none;' +
                        '-moz-user-select: none;' +
                        '-ms-user-select: none;' +
                        'user-select: none;' +
                        'pointer-events: none;' +
                '}';
                head = document.head || document.getElementsByTagName('head')[0];
                style = document.createElement('style');
                style.type = 'text/css';
                style.dataset.title = "style-helper"; // just in case we want to identify our stylesheet later

                if (style.styleSheet) { // IE only
                    style.styleSheet.cssText = css;
                } else {
                    style.appendChild(document.createTextNode(css));
                }
                head.appendChild(style);
                inertSheet = style.sheet;
            };
            return inertSheet;
        },



        /**
         * Returns the loaded stylesheet with a data-title attribute matching the argument.
         * We use data-title instead of title attribute as this is reserved for alternate stylesheets.
         * @param datatitle - the data-title attribute name to look for
         * @returns {Stylesheet} the found stylesheet or null
         */
        getSheetFromDataDataTitle: function (datatitle) {
            var sheet = null;

            for (var i = 0; i < document.styleSheets.length; i++) {
                sheet = document.styleSheets[i];
                if (sheet.dataset.title === datatitle) {
                    break;
                }
            }
            return sheet;
        },

        /**
         * Returns an object that contains the style defined for 'selector' in the stylesheet 'sheet'.
         * @param selector (String} the selector to retrieve the style from
         * @param sheet {Stylesheet} the stylesheet where to look for the selector
         * @returns {Object}
         */
        getStyle: function (selector, sheet) {
            sheet = sheet || {};
            var styleMatchMap = {},
                cssRules = sheet.cssRules || [],
                cssStyleDeclaration = {}
            ;

            for (var x = 0; x < cssRules.length; x++) {
                if (cssRules[x].selectorText == selector) {
                    cssStyleDeclaration = cssRules[x].style;
                    for (var prop in cssStyleDeclaration) {
                        if (cssStyleDeclaration.hasOwnProperty(prop) &&
                            typeof cssStyleDeclaration[prop] === "string" &&
                            isNaN(prop) === true &&
                            cssStyleDeclaration[prop] !== "" &&
                            prop !== "cssText") {
                            styleMatchMap[prop] = cssStyleDeclaration[prop];
                        }
                    }
                    break;
                }
            }
            return styleMatchMap;
        },


        /**
         * Add a css rule in the specified stylesheet or "inert stylesheet" if not stylesheet provided
         * @param {String} cssrule - the css rule to add, ex: ".foo { display: inline-block; }"
         * @param {Stylesheet} (Optional) sheet - the stylesheet where we want to add the rule, uses inert stylesheet by default
         * @returns {CSSStyleDeclaration} a reference to the style object we added
         */
        addCSSRule: function (cssrule, sheet) {
            sheet = sheet || this.getInertSheet();

            if (sheet.insertRule) {
                sheet.insertRule(cssrule, 0); // insert first
            } else { // non-standard addRule
                var matches = /([^{]+){([^}]+)}/g.exec(cssrule);
                var selector = matches[0].trim();
                var body = matches[1].trim();
                sheet.addRule(selector, body, 0);
            }
            return sheet.cssRules[0].style;
        },

        /**
         * Make an element "inert" aka totally invisible in the DOM.
         * @param {HTMLElement} elt - the DOM node we want to make inert
         * @returns {Object} an objet holding all the original styles of arg elt that were overriden to make it inert
         */
        makeInert: function (elt) {
            var defaults = window.getComputedStyle(elt),
                inertStyle = this.getStyle('.inert', this.getInertSheet()),
                 overridenByInertStyles = {}
            ;

            elt.dataset.tabindex = elt.getAttribute("tabindex");
            elt.setAttribute("tabindex", "-1"); // prevent focusable/tabbable

            elt.classList.add("inert");

            for (var prop in inertStyle) {
                if (inertStyle.hasOwnProperty(prop)) {
                    overridenByInertStyles[prop] = defaults[prop] || "initial";
                }
            }
            return overridenByInertStyles;
        },

        /**
         * Restore an element made inert to its original styles
         * @param {HTMLElement} elt - the element to restore
         */
        unmakeInert: function (elt) {
            elt.classList.remove("inert");
            elt.setAttribute("tabindex", elt.dataset.tabindex);
        }
    };
}));
