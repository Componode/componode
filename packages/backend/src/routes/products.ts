import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
} from "@componode/core";
import type { AuthenticatedRequest } from "../plugins/session.js";
import { requireRole } from "../plugins/rbac.js";
import {
  listProducts,
  getProductDetail,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../services/product-service.js";
import {
  addComposesEdge,
  removeComposesEdge,
  addConsumesFromEdge,
  removeConsumesFromEdge,
  addDependsOnEdge,
  removeDependsOnEdge,
} from "../services/product-edge-service.js";
import type { Actor } from "../services/audit-service.js";

type ServiceError = {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
};

function actor(req: AuthenticatedRequest): Actor {
  return {
    id: req.user?.id ?? null,
    name: req.user?.displayName ?? req.user?.username ?? null,
  };
}

function sendServiceError(reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) {
    return validationFailed(reply, err.issues);
  }
  const error = err as ServiceError;
  if (error.statusCode && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      code: error.code ?? "CONFLICT",
      message: error.message ?? "Request failed",
      ...(error.details ? { details: error.details } : {}),
    });
  }
  throw err;
}

function validationFailed(reply: FastifyReply, issues: unknown) {
  return reply
    .status(400)
    .send({ code: "VALIDATION_FAILED", message: "Invalid input", details: issues });
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/products",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = listProductsQuerySchema.safeParse(req.query);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      const result = await listProducts(parsed.data);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/products",
    { preHandler: [app.verifySession, requireRole("product:create")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const parsed = createProductSchema.safeParse(req.body);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const product = await createProduct(parsed.data, actor(req));
        return reply.status(201).send({ product });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.get(
    "/products/:slug",
    { preHandler: [app.verifySession] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { slug } = req.params as { slug: string };
      const detail = await getProductDetail(slug);
      if (!detail) {
        return reply
          .status(404)
          .send({ code: "NOT_FOUND", message: "Product not found" });
      }
      return reply.status(200).send(detail);
    },
  );

  app.patch(
    "/products/:id",
    { preHandler: [app.verifySession, requireRole("product:update")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const parsed = updateProductSchema.safeParse(req.body);
      if (!parsed.success) return validationFailed(reply, parsed.error.issues);
      try {
        const product = await updateProduct(id, parsed.data, actor(req));
        if (!product) {
          return reply
            .status(404)
            .send({ code: "NOT_FOUND", message: "Product not found" });
        }
        return reply.status(200).send({ product });
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.delete(
    "/products/:id",
    { preHandler: [app.verifySession, requireRole("product:delete")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        const product = await deleteProduct(id, actor(req));
        if (!product) {
          return reply
            .status(404)
            .send({ code: "NOT_FOUND", message: "Product not found" });
        }
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  // --- Edge endpoints (bodies validated by service schemas) ------------

  app.post(
    "/products/:id/composes",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        await addComposesEdge(id, req.body, actor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.delete(
    "/products/:id/composes/:childId",
    { preHandler: [app.verifySession, requireRole("product:edge:remove")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id, childId } = req.params as { id: string; childId: string };
      try {
        await removeComposesEdge(id, childId, actor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/products/:id/consumes-from",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        await addConsumesFromEdge(id, req.body, actor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.delete(
    "/products/:id/consumes-from/:platformId",
    { preHandler: [app.verifySession, requireRole("product:edge:remove")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id, platformId } = req.params as { id: string; platformId: string };
      try {
        await removeConsumesFromEdge(id, platformId, actor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.post(
    "/products/:id/depends-on",
    { preHandler: [app.verifySession, requireRole("product:edge:add")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        await addDependsOnEdge(id, req.body, actor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );

  app.delete(
    "/products/:id/depends-on/:targetId",
    { preHandler: [app.verifySession, requireRole("product:edge:remove")] },
    async (req: AuthenticatedRequest, reply: FastifyReply) => {
      const { id, targetId } = req.params as {
        id: string;
        targetId: string;
      };
      const { kind } = req.query as { kind?: string };
      if (kind !== undefined && kind !== "component" && kind !== "group") {
        return reply.status(400).send({
          code: "VALIDATION_FAILED",
          message: "kind must be 'component' or 'group'",
        });
      }
      try {
        await removeDependsOnEdge(id, targetId, kind ?? "component", actor(req));
        return reply.status(204).send();
      } catch (err) {
        return sendServiceError(reply, err);
      }
    },
  );
}
