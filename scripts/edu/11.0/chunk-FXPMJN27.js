import{b as E}from"./chunk-LTMRYDXY.js";import{a as w}from"./chunk-X45ANIQG.js";import{c as N}from"./chunk-KPVBKX4S.js";import{P as C,aa as v}from"./chunk-NSQ3RD6F.js";import{Ea as s,Ec as l,Fc as h,Gc as f,Yc as g,Zb as m,Zc as u,_c as y,bb as d,eb as c,lb as p}from"./chunk-5ZLKTVWI.js";var _=["iframe"],b=(()=>{class r{constructor(){this.nodeHelper=s(v),this.elementRef=s(c),this.configuration=s(w,{optional:!0}),this.cspNonce=s(p,{optional:!0}),this.componentBaseUrl="";let t=this.configuration;t&&t.assetsUrl&&(E.assetsFolder=(t?.assetsUrl||"")+"/ngx-extended-pdf-viewer",this.componentBaseUrl=(t?.assetsUrl||"").replace("/assets","/pdf"))}ngOnChanges(t){this.nodeHelper.getNodesRight([this.node],"DownloadContent",C.Effective)&&setTimeout(()=>this.initFrame(this.data?.items?.[0]?.link??""))}initFrame(t){let e=this.iframe.nativeElement,n=e.contentDocument||e.contentWindow?.document;if(n){let o=getComputedStyle(this.elementRef.nativeElement).getPropertyValue("--containerHeight").trim();o&&(e.style.height=o),e.onload=()=>{let a=(e.contentDocument||e.contentWindow?.document).getElementsByTagName("es-pdf")[0];a.data=this.data,a.node=this.node,a.assetUrl=this.componentBaseUrl+"/assets"};let i=this.cspNonce?` nonce="${this.cspNonce}"`:"";n.open(),n.write(`<!DOCTYPE html><html><head>
        <style${i}>
          html, body { margin: 0; padding: 0; height: 100%; }
          es-pdf { display: block; height: 100%; }
          ${o?`:root { --containerHeight: ${o}; }`:""}
        </style>
</head><body>
      <!--
        the angular app inside the iframe resolves the CSP_NONCE token via its default factory, which
        looks up \`document.body.querySelector('[ngCspNonce]')\` \u2014 on the iframe document, so the marker
        of the hosting page does not apply here. ngx-extended-pdf-viewer reads the same token for its
        dynamically generated css and its pdf.js script tags.
      -->
      ${this.cspNonce?`<div ngCspNonce="${this.cspNonce}" hidden></div>`:""}
      <script${i} src="${this.componentBaseUrl}/runtime.js" type="module"><\/script>
      <script${i} src="${this.componentBaseUrl}/polyfills.js" type="module"><\/script>
      <script${i} src="${this.componentBaseUrl}/vendor.js" type="module"><\/script>
      <script${i} src="${this.componentBaseUrl}/main.js" type="module"><\/script>
      <es-pdf></es-pdf>
</body></html>`),n.close()}}static{this.\u0275fac=function(e){return new(e||r)}}static{this.\u0275cmp=m({type:r,selectors:[["rs-module-pdf-iframe"]],viewQuery:function(e,n){if(e&1&&g(_,5),e&2){let o;u(o=y())&&(n.iframe=o.first)}},inputs:{data:"data",node:"node"},features:[d],decls:3,vars:0,consts:[["iframe",""],[1,"pdf-wrapper"]],template:function(e,n){e&1&&(l(0,"div",1),f(1,"iframe",null,0),h())},dependencies:[N],styles:["[_nghost-%COMP%]{position:relative;display:flex;align-items:center;width:100%;height:100%}.pdf-wrapper[_ngcontent-%COMP%]{width:100%;height:100%}.pdf-wrapper[_ngcontent-%COMP%]   iframe[_ngcontent-%COMP%]{width:100%;height:500px;border:0}@media print{.hide-all[_ngcontent-%COMP%]   *[_ngcontent-%COMP%]{display:none!important}}"]})}}return r})();export{b as a};
