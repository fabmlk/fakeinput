(function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            "jquery",
            "stylehelper"
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(require("jquery"), require("stylehelper"));
    } else {
        // Browser globals
        factory(jQuery, StyleHelper);
    }
}(function ($, StyleHelper) {

    var $currentlyFocused = $();
    var $fakeCaret = $(); // only one care instance for everyone
    var $textWidthCalculator = $();


    function FakeInput() {
        this.defaults = {

        };
    }

    $.extend(FakeInput.prototype, {
        markerClassName: 'fab-isFakeInput',
        propertyName: 'fab-fakeinput',

        setDefaults: function (options) {
            $.extend(this.defaults, options || {});
            return this;
        },

        _attachPlugin: function (target, options) {
            target = $(target);
            var inst;

            if (target.hasClass(this.markerClassName)) {
                return;
            }

            inst = {
                options: $.extend({}, this.defaults),
                textOverflow: {
                    left: "",
                    right: ""
                }
            };

            if (target.is("input[type='text']")) { // if an input text is specified, replace it
                // here we want to scavenge all attributes/properties assigned inline on the input
                // as input is a children-less element, using outerHTML fits the need.
                // Note: this is does not preserve attached event handlers! there is no way to find them out in pure javascript!
                // Also jquery remove jquery event handlers + data when replacing.
                target = $(target[0].outerHTML.replace("input", "span")).replaceAll(target); // replaceAll returns the new object, whereas replaceWith the old one!
                // target.removeAttr("type"); // remove type='text'
            }


            target.data(this.propertyName, inst)
                .attr("tabindex", "1"); // make it focusable/tabbable

            this._setCaretPlugin();
            this._impersonateInputStyle(target);
            this._impersonateInputAttributes(target);
            this._initEvents(target);

            this._optionPlugin(target, options);
        },



        _optionPlugin: function (target, options, value) {
            /* start of boilerplate code common to most jquery plugins */
            target = $(target);
            var inst = target.data(this.propertyName); // retrieve current instance settings

            if (!options || (typeof options == 'string' && value == null)) {
                // Get option
                var name = options;
                options = (inst || {}).options;
                return (options && name ? options[name] : options);
            }

            if (!target.hasClass(this.markerClassName)) { // if plugin not yet initialized
                return;
            }

            options = options || {};
            if (typeof options == 'string') { // handle single named option
                var name = options;
                options = {};
                options[name] = value;
            }
            $.extend(inst.options, options); // update with new options
            /* end of boilerplate code */
        },


        _setCaretPlugin: function (caretChar) {
            caretChar = caretChar || '|';

            if (!$fakeCaret.length) {
                $fakeCaret = $("<span id='" + this.propertyName + "-fakecaret' class='"+ this.propertyName +"-fakecaret'></span>");
                StyleHelper.makeInert($fakeCaret[0]);
                $("body").append($fakeCaret);
            }
            $fakeCaret.text(caretChar);
        },



        _impersonateInputStyle: function ($target) {
            var $realInput = $('#' + this.propertyName + '-impersonated-input'),
                stylesToRestore = {},
                computedInputStyle = {},
                realInputStyle = null,
                fakeInputStyle = {
                    overflow: "hidden",
                    cursor: "text"
                }
            ;

            if (!$realInput.length) {

                $realInput = $("<input type='text' id='" + this.propertyName + "-impersonated-input'>");
                stylesToRestore = StyleHelper.makeInert($realInput[0]);
                $("body").append($realInput);

                computedInputStyle = window.getComputedStyle($realInput[0]);
                realInputStyle = StyleHelper.addCSSRule('.' + this.markerClassName +  '{' + computedInputStyle.cssText + ')');

                $.extend(stylesToRestore, fakeInputStyle); // combine styles to restore + fake input specific styles

                for (var prop in stylesToRestore) { // override styles
                    if (stylesToRestore.hasOwnProperty(prop)) {
                        realInputStyle[prop] = stylesToRestore[prop];
                    }
                }
            }

            $target.addClass(this.markerClassName);
        },




        _impersonateInputAttributes: function ($target) {
            var target = $target[0],
                inst = $target.data(this.propertyName),
                adjustedVal
            ;

            Object.defineProperty(target, "value", {
                get: function () {
                    return inst.textOverflow.left + $target.text() + inst.textOverflow.right;
                },
                set: function (val) {
                    var adjustedVal,
                        overflowIdx = plugin._getIndexOverflowing($target, val)
                    ;

                    if (overflowIdx !== -1) {
                        inst.textOverflow.right = val.substring(overflowIdx);
                        adjustedVal = val.substring(0, overflowIdx);
                    } else {
                        adjustedVal = val;
                    }

                    $target.text(adjustedVal);
                }
            });

            $target.val($target.attr("value") || ""); // make use of what we've just setup above
            target.selectionStart = target.selectionEnd = $target.text().length;
            if (target.selectionEnd > target.textContent.length) {
                debugger;
            }

            target.focus = function () {
                // don't use jquery trigger as it will call .focus() => infinite loop!
                var focusEvent = new FocusEvent("focus");
                target.dispatchEvent(focusEvent);
            };

            target.blur = function () {
                // don't use jquery trigger as it will call .blur() => infinite loop!
                var blurEvent = new FocusEvent("blur"); // Blur hérite de FocusEvent interface
                target.dispatchEvent(blurEvent);
            };
        },


        _getIndexOverflowing: function ($target, value) {
            var testValue = value[0];

            for (var i = 1; i < value.length; i++) {
                testValue += value[i];
                if (plugin._isValueOverflowing($target, testValue)) {
                    return i;
                }
            }
            return -1;
        },


        _isValueOverflowing: function ($target, value) {
            var fontStyle = window.getComputedStyle($target[0]).font,
                textWidth = this._getTextContentWidth(value, fontStyle);
            ;

            return $target.innerWidth() < textWidth;
        },



        _getCaretCoordinates: function ($target) {
            var target = $target[0],
                textNode = target.childNodes[0],   // the text node is always the first child
                range = document.createRange(),
                rangeRect,
                targetRect
            ;

            if (textNode === undefined) {
                textNode = document.createTextNode("");
                $target.append(textNode);
            }

            range.setStart(textNode, 0);
            range.setEnd(textNode, target.selectionEnd);

            rangeRect = range.getBoundingClientRect();
            targetRect = target.getBoundingClientRect();

            return {
                top: Math.max(targetRect.top, 0),
                left: Math.max(0, Math.min(rangeRect.right, targetRect.right - 3)) // prevent going further than input border right
            };
        },


        _getSelectionRangePos: function ($target) {
            var start = -1, end = -1,
                userSelection = window.getSelection()
            ;

            if (userSelection.anchorNode === $target[0].childNodes[0]) { // first child must be text node
                start = userSelection.anchorOffset;
                end = start + userSelection.toString().length;
            }

            return {
                start: start,
                end: end
            };
        },


        _showCursor: function ($target) {
            var coords = this._getCaretCoordinates($target);

            $fakeCaret.css({
                // reminder: jquery converts a number to string and append "px" when it detects a number
                top: coords.top,
                left: coords.left,
                height: $target.outerHeight()
            });

            StyleHelper.unmakeInert($fakeCaret[0]);
        },


        _getTextContentWidth: function (text, fontStyle) {
            if (!$textWidthCalculator.length) {
                $textWidthCalculator = $("<span id='" + this.propertyName + "-widthcalculator'>");
                StyleHelper.makeInert($textWidthCalculator[0]);
                $textWidthCalculator.css({
                    margin: 0,
                    padding: 0,
                    borderWidth: 0
                });
                $("body").append($textWidthCalculator);
            }

            $textWidthCalculator.css("font", fontStyle)
                .text(text);

            return $textWidthCalculator.innerWidth();
        },


        _shiftContentLeft: function ($target) {
            var inst = $target.data(this.propertyName),
                charBefore,
                valueWithoutLastLetter
            ;

            if (inst.textOverflow.left.length > 0) {
                charBefore = inst.textOverflow.left.slice(-1);
                valueWithoutLastLetter = $target.text().slice(0, -1);

                $target.text(charBefore + valueWithoutLastLetter);

                inst.textOverflow.left = inst.textOverflow.left.slice(0, -1);
            }
        },

        _shiftContentRight: function ($target) {
            var inst = $target.data(this.propertyName),
                charAfter,
                valueWithoutFirstLetter
            ;

            if (inst.textOverflow.right.length > 0) {
                charAfter = inst.textOverflow.right[0];
                valueWithoutFirstLetter = $target.text().substring(1);

                $target.text(valueWithoutFirstLetter + charAfter);

                inst.textOverflow.right = inst.textOverflow.right.substring(1);
            }
        },



        _initEvents: function ($target) {
            $target.on("click", function (e) {
                var $this = $(this),
                    selectionRange = plugin._getSelectionRangePos($this)
                ;

                // Oddly, when we click to the very far left of the element, the selectionRange detects
                // the adjacent of this one, though we know we are inside the node!
                // This does not seam to occur at the very far right, so we can be safe to assume we are in this
                // situation when we detect -1.
                // Bug WebKit/Blink? Anyway, in that case force selection at the start.
                this.selectionStart = selectionRange.start === -1 ? 0 : selectionRange.start;
                this.selectionEnd = selectionRange.end === -1 ? 0 : selectionRange.end;

                if (this.selectionEnd > this.textContent.length) {
                    debugger;
                }

                console.log("clicked");
                this.focus();

                e.stopPropagation();
            })
            .on("focus", function () {
                plugin._showCursor($(this));
                $currentlyFocused = $(this);
                console.log("focused");
            })
            .on("blur", function () {
                StyleHelper.makeInert($fakeCaret[0]);
            })
            .on("keypress", function (e) {
                var selStart = this.selectionStart,
                    selEnd = this.selectionEnd,
                    value = this.value,
                    $this = $(this),
                    currentLength = $this.text().length,
                    inst = $this.data(plugin.propertyName)
                ;

                if (e.which !== 13) { // not "Enter"
                    this.value = value.slice(0, selStart) + e.key + value.slice(selEnd);

                    if (selEnd === currentLength && inst.textOverflow.right.length) {
                        plugin._shiftContentRight($this);
                    } else {
                        this.selectionStart = this.selectionEnd = this.value.length;
                    }

                    if (this.selectionEnd > this.textContent.length) {
                        debugger;
                    }

                    plugin._showCursor($this);
                }
            })
            .on("keydown", function (e) {
                var selStart = this.selectionStart,
                    selEnd = this.selectionEnd,
                    value = this.value,
                    $this = $(this)
                ;

                if (e.which === 8 || e.which === 46) { // backspace or del
                    if (selEnd === selStart) { // pas de text selected
                        selStart = selStart > 0 ? selStart - 1 : selStart;
                    }
                    this.value = value.slice(0, selStart) + value.slice(selEnd);
                    this.selectionStart = this.selectionEnd = selStart;

                    if (this.selectionEnd > target.textContent.length) {
                        debugger;
                    }
                    plugin._showCursor($this);

                    return false; // prevent default & stop bubbling
                }
                if (e.which === 37) { // left arrow
                    if (this.selectionStart === 0) {
                        plugin._shiftContentLeft($(this));
                    }

                    this.selectionStart = this.selectionEnd = Math.max(this.selectionStart - 1, 0);
                    if (this.selectionEnd > target.textContent.length) {
                        debugger;
                    }
                    plugin._showCursor($this);

                } else if (e.which == 39) { // right arrow
                    if (this.selectionEnd === this.textContent.length) {
                        plugin._shiftContentRight($(this));
                    }

                    this.selectionStart = this.selectionEnd = Math.min(this.selectionEnd + 1, this.textContent.length);
                    if (this.selectionEnd > target.textContent.length) {
                        debugger;
                    }
                    plugin._showCursor($this);
                }
            });

            $(document).on("click", function (e) {
                if (!$(e.target).is('.' + plugin.markerClassName)) {
                    if ($currentlyFocused.length) {
                        $currentlyFocused[0].blur();
                        console.log("blurred");
                    }
                }
            });


        }


    });

    var plugin = $.fakeinput = new FakeInput();


    $.fn.fakeinput = function (options) {
        var otherArgs = Array.prototype.slice.call(arguments, 1);
        return this.each(function () {
            if (typeof options == 'string') {
                if (!plugin['_' + options + 'Plugin']) {
                    throw 'Unkown method: ' + options;
                }
                plugin['_' + options + 'Plugin'].apply(plugin, [this].concat(otherArgs));
            } else {
                plugin._attachPlugin(this, options || {});
            }
        });
    };

    $.fn.fakeinput.defaults = plugin.defaults;
}));