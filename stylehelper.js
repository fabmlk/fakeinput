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
    return {
        /**
         * Returns the loaded stylesheet with a data-title attribute matching the argument.
         * We use data-title instead of title attribute as this is reserved for alternate stylesheets.
         * @param datatitle - the data-title attribute name to look for
         * @returns {Stylesheet} the found stylesheet or null
         */
        getSheetFromDataTitle: function (datatitle) {
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
            var styleMatchMap = {};
            var cssRules = sheet.cssRules || [];
            var cssStyleDeclaration = {};

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
                    return styleMatchMap;
                }
            }
            return styleMatchMap;
        },

        /**
         * 
         * @param elt
         * @returns {{}}
         */
        makeInert: function (elt) {
            var defaults = window.getComputedStyle(elt);
            var inertStyle = getStyle('.inert', getSheetFromTitle("fakeInput"));
            var overridenByInertStyles = {};

            elt.dataset.tabindex = elt.getAttribute("tabindex");
            elt.setAttribute("tabindex", "-1");

            elt.classList.add("inert");

            for (var prop in inertStyle) {
                if (inertStyle.hasOwnProperty(prop)) {
                    overridenByInertStyles[prop] = defaults[prop] || "initial";
                }
            }
            return overridenByInertStyles;
        },

        unmakeInert: function (elt) {
            elt.classList.remove("inert");
            elt.setAttribute("tabindex", elt.dataset.tabindex);
        }
    };
}));
