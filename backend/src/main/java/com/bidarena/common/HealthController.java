package com.bidarena.common;

import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Mapping;

import java.util.Map;

@Controller
public class HealthController {
    @Get
    @Mapping("/api/v1/health")
    public ApiResult<Map<String, Object>> health() {
        return ApiResult.ok(Map.of("status", "UP", "time", System.currentTimeMillis()));
    }
}
