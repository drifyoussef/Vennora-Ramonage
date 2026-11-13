import type { FastifyInstance } from "fastify";
import { listQuerySchema, objectId } from "@vennora/core/schemas";
import { z } from "zod";
import { requireContext } from "../context";
import { getCustomer, listCustomers, listCustomerOptions } from "../data/customers";
import { parse } from "../http";

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/clients", async (request) => {
    const context = await requireContext(request, "customer.view");
    const query = parse(listQuerySchema, request.query);
    return listCustomers(context, query);
  });

  app.get("/api/clients/options", async (request) => {
    const context = await requireContext(request, "customer.view");
    return listCustomerOptions(context);
  });

  app.get("/api/clients/:id", async (request) => {
    const context = await requireContext(request, "customer.view");
    const { id } = parse(z.object({ id: objectId }), request.params);
    return getCustomer(context, id);
  });
}
