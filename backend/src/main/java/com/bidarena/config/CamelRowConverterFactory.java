package com.bidarena.config;

import org.noear.snack4.ONode;
import org.noear.solon.annotation.Component;
import org.noear.solon.data.sql.bound.RowConverter;
import org.noear.solon.data.sql.bound.RowConverterFactory;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 行转换工厂：在默认实现（ONode.ofBean(map).toBean(cls)）之上增加
 * 「数据库下划线列名 -> Java 驼峰字段」的键名归一化。
 *
 * 背景（GATE-A2 排查发现的真实缺陷）：
 * Solon 默认 RowConverter 不做下划线列名转换，导致 password_hash/display_name/
 * start_price 等列绑定到 JavaBean 时为 null（登录 BCrypt verify 恒 false 的根因）。
 * 注册本工厂后全局生效（SqlUtilsPlugin 会按 RowConverterFactory 类型装配），
 * SQL 不需要逐条写 AS 别名。
 */
@Component
public class CamelRowConverterFactory implements RowConverterFactory<Object> {
    @Override
    public RowConverter<Object> create(Class<?> tClass) {
        return new CamelRowConverter(tClass);
    }

    static class CamelRowConverter implements RowConverter<Object> {
        private final Class<?> tClass;
        private ResultSetMetaData metaData;

        CamelRowConverter(Class<?> tClass) {
            this.tClass = tClass;
        }

        @Override
        public Object convert(ResultSet rs) throws SQLException {
            if (metaData == null) {
                metaData = rs.getMetaData();
            }

            Map<String, Object> raw = new LinkedHashMap<>();
            Map<String, Object> camel = new LinkedHashMap<>();
            for (int i = 1; i <= metaData.getColumnCount(); i++) {
                String label = metaData.getColumnLabel(i);
                Object value = rs.getObject(i);
                raw.put(label, value);
                camel.put(toCamel(label), value);
            }

            if (Map.class == tClass) {
                return raw;
            }
            // 标量直通（与默认实现保持一致的多列兜底行为：取第一列）
            if (tClass == String.class || Number.class.isAssignableFrom(tClass)
                    || tClass == Boolean.class || tClass.isPrimitive()) {
                return camel.values().iterator().next();
            }
            return ONode.ofBean(camel).toBean(tClass);
        }
    }

    /** password_hash -> passwordHash；已是无下划线的原样返回 */
    static String toCamel(String column) {
        if (column == null || column.indexOf('_') < 0) {
            return column;
        }
        StringBuilder sb = new StringBuilder(column.length());
        boolean upper = false;
        for (char c : column.toCharArray()) {
            if (c == '_') {
                upper = true;
            } else if (upper) {
                sb.append(Character.toUpperCase(c));
                upper = false;
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
