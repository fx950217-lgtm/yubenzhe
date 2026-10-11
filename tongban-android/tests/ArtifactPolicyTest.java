package app.tongban.wallet.demo;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
public class ArtifactPolicyTest {
 private static int count;
 private static void check(boolean b,String label){count++;if(!b)throw new AssertionError(label);}
 private interface Run{void go();}
 private static void reject(Run r){boolean fail=false;try{r.go();}catch(IllegalArgumentException e){fail=true;}check(fail,"unsafe artifact rejected");}
 public static void main(String[]args){
  String body=Base64.getEncoder().encodeToString("标题\n一,二\n".getBytes(StandardCharsets.UTF_8));
  for(String[] pair:new String[][]{{"处理说明.txt","text/plain"},{"订单-整理.csv","text/csv; charset=utf-8"},{"行动清单.md","text/markdown"},{"report.json","application/json"}}){check(ArtifactPolicy.validateEnvelope(pair[0],pair[1],body).equals(pair[1].split(";")[0]),"match safe output MIME");}
  for(String filename:new String[]{"../file.txt","C:\\file.txt","/file.txt","x..txt",".txt","x.txt "," x.txt","x.exe","x.html","x.svg","x.txt.exe","a\nb\nc.txt","CON.txt","LPT1.csv","a\u202eb.txt","x".repeat(181)+".txt"})reject(()->ArtifactPolicy.validateEnvelope(filename,"text/plain",body));
  reject(()->ArtifactPolicy.validateEnvelope("file.csv","text/html",body));
  reject(()->ArtifactPolicy.validateEnvelope("file.csv","text/plain",body));
  for(String encoded:new String[]{"x","abcd\n","abc?","a===","=abc","a=bc","====","AA=A"})reject(()->ArtifactPolicy.validateEnvelope("file.txt","text/plain",encoded));
  ArtifactPolicy.validateBytes("真实成果\n".getBytes(StandardCharsets.UTF_8));check(true,"valid UTF8 bytes");
  ArtifactPolicy.validateBytes(new byte[0]);check(true,"empty real output permitted");
  reject(()->ArtifactPolicy.validateBytes(new byte[]{(byte)0xc3,0x28}));
  reject(()->ArtifactPolicy.validateBytes(new byte[]{0}));
  reject(()->ArtifactPolicy.validateBytes(new byte[ArtifactPolicy.MAX_BYTES+1]));
  System.out.println(count+" artifact export policy assertions passed");
 }
}
