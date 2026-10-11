package app.tongban.wallet.demo;

import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** System certificate and host validation, no redirect following or permissive trust manager. */
final class InternalPreviewHttps implements InternalPreviewSession.Exchange {
    @Override public InternalPreviewSession.Result send(String path,String method,Map<String,String> headers,byte[] body) throws IOException {
        HttpsURLConnection connection=(HttpsURLConnection)new URL(InternalPreviewPolicy.REMOTE+path).openConnection();
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setUseCaches(false);connection.setRequestMethod(method);
        for(Map.Entry<String,String> header:headers.entrySet())connection.setRequestProperty(header.getKey(),header.getValue());
        try {
            if(body!=null){connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);try(OutputStream output=connection.getOutputStream()){output.write(body);}}
            int status=connection.getResponseCode();
            if(connection.getContentLengthLong()>InternalPreviewPolicy.MAX_RESPONSE_BYTES)throw new IOException("接口返回内容过大。");
            Map<String,String> visible=new LinkedHashMap<>();List<String> cookies=new ArrayList<>();
            for(Map.Entry<String,List<String>> header:connection.getHeaderFields().entrySet()){
                if(header.getKey()==null)continue;String key=header.getKey().toLowerCase(Locale.ROOT);
                if(key.equals("set-cookie"))cookies.addAll(header.getValue());
                if(key.equals("content-type")||key.equals("content-disposition")||key.equals("etag")){String value=connection.getHeaderField(header.getKey());if(value!=null&&value.length()<=4096)visible.put(key,value);}
            }
            InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(stream!=null)try(InputStream input=stream){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(bytes.size()+count>InternalPreviewPolicy.MAX_RESPONSE_BYTES)throw new IOException("接口返回内容过大。");bytes.write(buffer,0,count);}}
            return new InternalPreviewSession.Result(status,bytes.toByteArray(),visible,cookies,connection.getHeaderField("Location"));
        } finally {connection.disconnect();}
    }
}
