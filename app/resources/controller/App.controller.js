sap.ui.define([
	"sap/ui/core/mvc/Controller"
],
	/**
	 * @param {typeof sap.ui.core.mvc.Controller} Controller
	 */
	function (Controller) {
		"use strict";

		return Controller.extend("com.tr.trialbalance.controller.App", {
			onInit: function () {
                /* --- In aluchpad app is not navigating to First view--- */
                /* Overriding the app navigation*/
                var oRouter = this.getOwnerComponent().getRouter();
                oRouter.navTo("OTP");
			}
		});
	});
