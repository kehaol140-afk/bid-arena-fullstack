package com.bidarena.common;

import org.noear.solon.annotation.*;
import org.noear.solon.core.handle.Context;
import org.noear.solon.docs.DocDocket;
import org.noear.solon.docs.models.ApiInfo;
import org.noear.solon.docs.openapi2.OpenApi2Utils;
import org.noear.snack4.ONode;

/** Public machine-readable Swagger/OpenAPI 2.0, generated from actual Solon actions. */
@Controller
public class OpenApiController {
    @Get
    @Mapping("/openapi.json")
    public void specification(Context ctx) throws Exception {
        DocDocket docket = new DocDocket().groupName("bid-arena").apis("com.bidarena")
                .info(new ApiInfo().title("Bid Arena API").version("1.0.0")
                        .description("Virtual-point auctions. Session Bearer and restricted Agent Bearer credentials are independent."));
        ONode spec=ONode.ofJson(OpenApi2Utils.getSwaggerJson(docket, ctx.header("Host")));
        ONode definitions=new ONode().asObject();
        definitions.set("SessionBearer", java.util.Map.of("type","apiKey","name","Authorization","in","header",
                "description","Bearer <session token>; admin operations additionally require ADMIN"));
        definitions.set("AgentBearer", java.util.Map.of("type","apiKey","name","Authorization","in","header",
                "description","Bearer <restricted Agent token>; auction scope and read/bid permissions are enforced"));
        spec.set("securityDefinitions",definitions);
        spec.get("paths").getObject().forEach((path, operations) -> {
            if (!path.startsWith("/api/v1/")) return;
            operations.getObject().forEach((method, operation) -> {
                if (!java.util.Set.of("get","post","put","delete","patch").contains(method)) return;
                boolean publicPath=path.equals("/api/v1/auth/login") || path.equals("/api/v1/health");
                operation.set("security",publicPath ? java.util.List.of() : java.util.List.of(
                        java.util.Map.of(path.startsWith("/api/v1/agent/") ? "AgentBearer" : "SessionBearer", java.util.List.of())));
            });
        });
        ctx.contentType("application/json;charset=UTF-8");
        ctx.output(spec.toJson());
    }
}
