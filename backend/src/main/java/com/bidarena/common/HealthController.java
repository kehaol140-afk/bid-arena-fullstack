package com.bidarena.common;

import com.bidarena.App;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Mapping;

import java.util.Map;

@io.swagger.annotations.Api(tags = "HealthController")
@Controller
public class HealthController {
    @io.swagger.annotations.ApiOperation(value = "Read HealthController")
    @Get
    @Mapping("/api/v1/health")
    public ApiResult<Map<String, Object>> health() {
        boolean ready = App.dbReady;
        return ApiResult.ok(Map.of(
                "status", ready ? "UP" : "STARTING",
                "time", System.currentTimeMillis()));
    }
}
