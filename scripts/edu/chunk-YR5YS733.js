import{b as v}from"./chunk-OKOPCMQD.js";import{a as w}from"./chunk-XSB64XAD.js";import{c as C}from"./chunk-2JRA322Y.js";import{P as u,aa as y}from"./chunk-63VBACCJ.js";import{Ea as s,Ec as p,Fc as c,Gc as l,Yc as f,Zb as m,Zc as h,_c as g,bb as a,eb as d}from"./chunk-SISH7RCI.js";var E=["iframe"],x=(()=>{class o{constructor(){this.nodeHelper=s(y),this.elementRef=s(d),this.configuration=s(w,{optional:!0}),this.componentBaseUrl="";let t=this.configuration;t&&t.assetsUrl&&(v.assetsFolder=(t?.assetsUrl||"")+"/ngx-extended-pdf-viewer",this.componentBaseUrl=(t?.assetsUrl||"").replace("/assets","/pdf"))}ngOnChanges(t){this.nodeHelper.getNodesRight([this.node],"DownloadContent",u.Effective)&&setTimeout(()=>this.initFrame(this.data?.items?.[0]?.link??""))}initFrame(t){let e=this.iframe.nativeElement,n=e.contentDocument||e.contentWindow?.document;if(n){let i=getComputedStyle(this.elementRef.nativeElement).getPropertyValue("--containerHeight").trim();i&&(e.style.height=i),e.onload=()=>{let r=(e.contentDocument||e.contentWindow?.document).getElementsByTagName("es-pdf")[0];r.data=this.data,r.node=this.node,r.assetUrl=this.componentBaseUrl+"/assets"},n.open(),n.write(`<!DOCTYPE html><html><head>
        <style>
          html, body { margin: 0; padding: 0; height: 100%; }
          es-pdf { display: block; height: 100%; }
          ${i?`:root { --containerHeight: ${i}; }`:""}
        </style>
</head><body>
      <script src="${this.componentBaseUrl}/runtime.js" type="module"><\/script>
      <script src="${this.componentBaseUrl}/polyfills.js" type="module"><\/script>
      <script src="${this.componentBaseUrl}/vendor.js" type="module"><\/script>
      <script src="${this.componentBaseUrl}/main.js" type="module"><\/script>
      <es-pdf></es-pdf>
</body></html>`),n.close()}}static{this.\u0275fac=function(e){return new(e||o)}}static{this.\u0275cmp=m({type:o,selectors:[["rs-module-pdf-iframe"]],viewQuery:function(e,n){if(e&1&&f(E,5),e&2){let i;h(i=g())&&(n.iframe=i.first)}},inputs:{data:"data",node:"node"},features:[a],decls:3,vars:0,consts:[["iframe",""],[1,"pdf-wrapper"]],template:function(e,n){e&1&&(p(0,"div",1),l(1,"iframe",null,0),c())},dependencies:[C],styles:["[_nghost-%COMP%]{position:relative;display:flex;align-items:center;width:100%;height:100%}.pdf-wrapper[_ngcontent-%COMP%]{width:100%;height:100%}.pdf-wrapper[_ngcontent-%COMP%]   iframe[_ngcontent-%COMP%]{width:100%;height:500px;border:0}@media print{.hide-all[_ngcontent-%COMP%]   *[_ngcontent-%COMP%]{display:none!important}}"]})}}return o})();export{x as a};
