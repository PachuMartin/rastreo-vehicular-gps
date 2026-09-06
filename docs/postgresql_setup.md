# Guía de Configuración: Base de Datos PostgreSQL Persistente

Para que los vehículos, dispositivos vinculados y recorridos históricos **NUNCA MÁS se borren** al reiniciar o entrar en reposo el servidor de Render, conectamos el sistema a una base de datos **PostgreSQL gratuita en la nube**.

El código de la aplicación ya detecta automáticamente la variable `DATABASE_URL`. Al configurarla, el sistema migra de forma transparente a PostgreSQL.

---

## 🌟 Opción Recomendada: Neon.tech (Gratis para siempre, configuración en 1 minuto)

[Neon.tech](https://neon.tech) es una plataforma especializada en PostgreSQL en la nube, con plan gratuito permanente (no expira a los 30 días como Render).

### Paso 1: Crear la Base de Datos en Neon
1. Ingresa a **[https://neon.tech](https://neon.tech)** y pulsa **Sign Up** (puedes iniciar sesión con tu cuenta de GitHub o Google).
2. Asigna un nombre al proyecto (por ejemplo: `rastreo-gps`) y pulsa **Create Project**.
3. En la pantalla principal verás el cuadro **Connection Details**.
4. Asegúrate de que esté seleccionado **Node.js** o **Connection string** y pulsa el botón de copiar. La URL tendrá un formato como este:
   ```text
   postgresql://usuario:contraseña@ep-xyz-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

## 🚀 Opción Alternativa: PostgreSQL directo en Render

Si prefieres tener todo dentro de Render:
1. En tu panel de **[Render](https://dashboard.render.com)**, pulsa el botón **"New +"** (arriba a la derecha).
2. Selecciona **PostgreSQL**.
3. Configura:
   * **Name**: `gps-db`
   * **Instance Type**: `Free`
4. Pulsa **Create Database**.
5. Espera unos segundos a que se cree y copia el valor de **Internal Database URL** (o *External Database URL* si da error interno).

---

## ⚙️ Paso Final: Pegar la URL en tu Servicio de Render

1. En el panel de Render, entra a tu Web Service existente (el de la aplicación de rastreo).
2. En el menú lateral izquierdo, haz clic en **Environment** (Variables de entorno).
3. Pulsa el botón **Add Environment Variable** (o *Add*).
4. Completa con:
   * **Key**: `DATABASE_URL`
   * **Value**: *(pega la URL completa copiada en el paso anterior)*
5. Pulsa **Save Changes**.

---

## ✅ Verificación

Render iniciará un despliegue automático con la nueva variable. En la pestaña **Logs** de Render verás:

```text
🐘 Motor de base de datos: PostgreSQL (Persistencia en la Nube)
✅ Esquema PostgreSQL inicializado y verificado
🚀 SERVIDOR DE RASTREO VEHICULAR GPS INICIADO
```

A partir de este momento:
* Puedes apagar, reiniciar o actualizar el servidor tantas veces como quieras.
* **Todos los vehículos, choferes, patentes y dispositivos vinculados quedarán guardados permanentemente**.
* Todo el historial de recorridos y métricas diarias se conservará de forma indefinida.
