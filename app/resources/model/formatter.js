sap.ui.define([], function () {
	"use strict";
	return {
		
		CompanyCodeText:function(key,text){
			if(text === ""){
				return "CompanyCode "+ key;
			}
            else{
                return text;
            }
		},
        LedgerKey:function(key){
            if(key === ""){
                return "#";
            }
            else{
                return key;
            }
        }

	};
});