import{b as _}from"./chunk-ZEK4LSRX.js";import{a as P}from"./chunk-5PQYINBK.js";import{c as E}from"./chunk-26D3UGV3.js";import{S as N,da as w}from"./chunk-LRN4VRRP.js";import{Dc as h,Ea as s,Ec as f,Fb as m,Fc as g,Mc as u,Xc as y,Yb as l,Yc as C,Zc as v,bb as d,eb as c,lb as p}from"./chunk-QZGNXONX.js";var $=["iframe"],j=(()=>{class r{constructor(){this.nodeHelper=s(w),this.elementRef=s(c),this.configuration=s(P,{optional:!0}),this.cspNonce=s(p,{optional:!0}),this.componentBaseUrl="";let t=this.configuration;t&&t.assetsUrl&&(_.assetsFolder=(t?.assetsUrl||"")+"/ngx-extended-pdf-viewer",this.componentBaseUrl=(t?.assetsUrl||"").replace("/assets","/pdf"))}ngOnChanges(t){this.nodeHelper.getNodesRight([this.node],"DownloadContent",N.Effective)&&setTimeout(()=>this.initFrame(this.data?.items?.[0]?.link??""))}initFrame(t){let e=this.iframe.nativeElement,n=e.contentDocument||e.contentWindow?.document;if(n){let i=getComputedStyle(this.elementRef.nativeElement).getPropertyValue("--containerHeight").trim();i&&(e.style.height=i),e.onload=()=>{let a=(e.contentDocument||e.contentWindow?.document).getElementsByTagName("es-pdf")[0];a.data=this.data,a.node=this.node,a.assetUrl=this.componentBaseUrl+"/assets"};let o=this.cspNonce?` nonce="${this.cspNonce}"`:"";n.open(),n.write(`<!DOCTYPE html><html><head>
        <style${o}>
          html, body { margin: 0; padding: 0; height: 100%; }
          es-pdf { display: block; height: 100%; }
          ${i?`:root { --containerHeight: ${i}; }`:""}
        </style>
</head><body>
      <!--
        the angular app inside the iframe resolves the CSP_NONCE token via its default factory, which
        looks up \`document.body.querySelector('[ngCspNonce]')\` \u2014 on the iframe document, so the marker
        of the hosting page does not apply here. ngx-extended-pdf-viewer reads the same token for its
        dynamically generated css and its pdf.js script tags.
      -->
      ${this.cspNonce?`<div ngCspNonce="${this.cspNonce}" hidden></div>`:""}
      <script${o} src="${this.componentBaseUrl}/runtime.js" type="module"><\/script>
      <script${o} src="${this.componentBaseUrl}/polyfills.js" type="module"><\/script>
      <script${o} src="${this.componentBaseUrl}/vendor.js" type="module"><\/script>
      <script${o} src="${this.componentBaseUrl}/main.js" type="module"><\/script>
      <es-pdf></es-pdf>
</body></html>`),n.close()}}static{this.\u0275fac=function(e){return new(e||r)}}static{this.\u0275cmp=l({type:r,selectors:[["rs-module-pdf-iframe"]],viewQuery:function(e,n){if(e&1&&y($,5),e&2){let i;C(i=v())&&(n.iframe=i.first)}},inputs:{data:"data",node:"node"},features:[d],decls:3,vars:1,consts:[["iframe",""],[1,"pdf-wrapper"],[3,"title"]],template:function(e,n){e&1&&(h(0,"div",1),g(1,"iframe",2,0),f()),e&2&&(m(),u("title",(n.node==null?null:n.node.title)??"PDF"))},dependencies:[E],styles:["[_nghost-%COMP%]{position:relative;display:flex;align-items:center;width:100%;height:100%}.pdf-wrapper[_ngcontent-%COMP%]{width:100%;height:100%}.pdf-wrapper[_ngcontent-%COMP%]   iframe[_ngcontent-%COMP%]{width:100%;height:500px;border:0}@media print{.hide-all[_ngcontent-%COMP%]   *[_ngcontent-%COMP%]{display:none!important}}"]})}}return r})();export{j as a};
