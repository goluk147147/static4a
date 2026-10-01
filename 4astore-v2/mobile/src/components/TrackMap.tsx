import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Tracking } from '../types';

// Leaflet + OpenStreetMap + OSRM route (no paid map key), same as the web Track page.
const HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0}</style></head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('m',{zoomControl:true}).setView([24.58,84.11],14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);
var layer=L.layerGroup().addTo(map);
function icon(e){return L.divIcon({html:'<div style="font-size:26px">'+e+'</div>',className:'',iconSize:[26,26]});}
window.draw=function(d){try{layer.clearLayers();var b=[];
 if(d.store){L.marker([d.store.latitude,d.store.longitude],{icon:icon('🏪')}).addTo(layer).bindPopup('4A Store');b.push([d.store.latitude,d.store.longitude]);}
 if(d.customer&&d.customer.latitude&&d.customer.longitude){L.marker([d.customer.latitude,d.customer.longitude],{icon:icon('🏠')}).addTo(layer).bindPopup('Delivery address');b.push([d.customer.latitude,d.customer.longitude]);}
 if(d.rider&&d.rider.location){L.marker([d.rider.location.latitude,d.rider.location.longitude],{icon:icon('🛵')}).addTo(layer).bindPopup('Rider');b.push([d.rider.location.latitude,d.rider.location.longitude]);}
 if(d.route&&d.route.polyline&&d.route.polyline.coordinates){var ll=d.route.polyline.coordinates.map(function(c){return[c[1],c[0]]});L.polyline(ll,{color:'#ff7a00',weight:5}).addTo(layer);ll.forEach(function(p){b.push(p)});}
 if(b.length>1)map.fitBounds(b,{padding:[40,40]});else if(b.length)map.setView(b[0],15);
}catch(e){}};
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready');
</script></body></html>`;

export default function TrackMap({ data, height = 360 }: { data?: Tracking | null; height?: number }) {
  const ref = useRef<WebView>(null);
  const ready = useRef(false);
  const payload = useMemo(() => (data ? JSON.stringify(data) : ''), [data]);

  const push = () => {
    if (ready.current && payload) ref.current?.injectJavaScript(`window.draw(${payload});true;`);
  };
  useEffect(push, [payload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', backgroundColor: '#eee' }} accessibilityLabel="Live tracking map">
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'https://4astore.local/' }}
        onMessage={(e) => {
          if (e.nativeEvent.data === 'ready') {
            ready.current = true;
            push();
          }
        }}
        javaScriptEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
