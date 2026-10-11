package app.tongban.wallet.demo;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Work results only; system picker chooses the destination. Never code, HTML or arbitrary binary. */
public final class ArtifactPolicy {
    public static final int MAX_BYTES=16*1024*1024;
    public static final int MAX_BASE64_CHARS=((MAX_BYTES+2)/3)*4;
    private ArtifactPolicy(){}
    public static String validateEnvelope(String filename,String mimeType,String bodyBase64){
        if(filename==null||filename.isEmpty()||filename.length()>180||filename.getBytes(StandardCharsets.UTF_8).length>240||filename.startsWith(".")||filename.contains("..")||java.util.regex.Pattern.compile("[\\\\/:*?\"<>|\\x00-\\x1f\\x{202A}-\\x{202E}\\x{2066}-\\x{2069}]").matcher(filename).find()||!filename.equals(filename.trim())||filename.endsWith("."))throw new IllegalArgumentException("成果文件名无效，不能包含路径。");
        int dot=filename.lastIndexOf('.');if(dot<1)throw new IllegalArgumentException("成果文件缺少扩展名。");
        String stem=filename.substring(0,dot).toUpperCase(Locale.ROOT);if(stem.matches("(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\..*)?"))throw new IllegalArgumentException("成果文件名不能使用系统保留名称。");
        String ext=filename.substring(dot+1).toLowerCase(Locale.ROOT);
        String mime=mimeType==null?"":mimeType.split(";",2)[0].trim().toLowerCase(Locale.ROOT);
        String expected="txt".equals(ext)?"text/plain":"csv".equals(ext)?"text/csv":"md".equals(ext)?"text/markdown":"json".equals(ext)?"application/json":"";
        if(expected.isEmpty()||!expected.equals(mime))throw new IllegalArgumentException("仅支持 TXT、CSV、Markdown 和 JSON 文本成果。");
        if(bodyBase64==null||bodyBase64.length()>MAX_BASE64_CHARS||bodyBase64.length()%4!=0)throw new IllegalArgumentException("成果内容格式无效或超过 16 MiB。");
        int padding=0;for(int i=0;i<bodyBase64.length();i++){char c=bodyBase64.charAt(i);if(c=='='){padding++;if(padding>2||i<bodyBase64.length()-2)throw new IllegalArgumentException("成果编码无效。");}else if(padding!=0||!((c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='+'||c=='/'))throw new IllegalArgumentException("成果编码无效。");}
        return expected;
    }
    public static void validateBytes(byte[] bytes){
        if(bytes==null||bytes.length>MAX_BYTES)throw new IllegalArgumentException("成果内容超过 16 MiB。");
        for(byte value:bytes)if(value==0)throw new IllegalArgumentException("成果不能包含二进制内容。");
        try{StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));}
        catch(CharacterCodingException error){throw new IllegalArgumentException("成果必须使用 UTF-8 文本编码。");}
    }
}
