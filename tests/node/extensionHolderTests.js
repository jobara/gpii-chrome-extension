/*
 * GPII Chrome Extension for Google Chrome
 *
 * Copyright 2016 RtF-US
 *
 * Licensed under the New BSD license. You may not use this file except in
 * compliance with this license.
 *
 * You may obtain a copy of the license at
 * https://github.com/GPII/gpii-chrome-extension/blob/master/LICENSE.txt
 */

/* eslint-env node */
/* global require */

"use strict";

var fluid = require("infusion");
var chrome = chrome || fluid.require("sinon-chrome", require, "chrome");
var jqUnit = fluid.require("node-jqunit", require, "jqUnit");
var gpii = fluid.registerNamespace("gpii");

require("../../extension/src/lib/extensionHolder.js");

jqUnit.module("GPII Chrome Extension extensionHolder unit tests");

jqUnit.test("Running unit tests for extensionHolder", function () {
    // Mock of a 3rd party extensionMock
    //
    fluid.defaults("gpii.chrome.tests.extensionMock", {
        gradeNames: "gpii.chrome.extensionHolder",
        extensionId: "abcdefghijklmnoprstuvwxyz0123456",
        model: {
            extensionEnabled: false
        }
    });

    var extInfoMock = {
        "description": "Chrome Extension Mock",
        "disabledReason": "unknown",
        "enabled": true,
        "id": "abcdefghijklmnoprstuvwxyz0123456",
        "mayDisable": true,
        "name": "ChromeExtensionMock",
        "shortName": "Mocky",
        "type": "extension",
        "version": "0.1"
    };

    var expectedInstance = fluid.copy(extInfoMock);
    // set enabled state to false, to match model value
    expectedInstance.enabled = false;

    // Mock this call to chrome.management.get
    //
    chrome.management.get.yields(extInfoMock);
    var ext = gpii.chrome.tests.extensionMock();

    jqUnit.assertDeepEq("Check that the extensionMock has been successfully populated", expectedInstance, ext.extensionInstance);

    chrome.management.setEnabled.func = function (id, value) {
        jqUnit.assertTrue("setEnabled gets a boolean value", "boolean", typeof(value));
    };

    ext.applier.change("extensionEnabled", true);
    jqUnit.assertTrue("Checking that ext.model.extensionEnabled is true", ext.model.extensionEnabled);
    jqUnit.assertTrue("Checking that ext.extensionInstance.enabled is true", ext.extensionInstance.enabled);

    ext.applier.change("extensionEnabled", false);
    jqUnit.assertFalse("Checking that ext.model.extensionEnabled is false", ext.model.extensionEnabled);
    jqUnit.assertFalse("Checking that ext.extensionInstance.enabled is false", ext.extensionInstance.enabled);

    chrome.runtime.lastError = true;
    ext.events.onExtUninstalled.fire(extInfoMock.id);
    jqUnit.assertUndefined("Checking that the extensionInstance has been cleared", ext.extensionInstance);
    chrome.runtime.lastError = undefined;

    ext.events.onExtInstalled.fire(extInfoMock);
    jqUnit.assertDeepEq("Check that the extensionInstance has been successfully repopulated", expectedInstance, ext.extensionInstance);

    chrome.flush();
});
