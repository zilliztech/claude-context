#!/usr/bin/env python3
"""
A simple math server using MCP (Model Context Protocol).
This server provides basic mathematical operations as tools.
"""

from mcp.server.fastmcp import FastMCP

# Create the MCP server
mcp = FastMCP("Math Server")


@mcp.tool()
def add(a: float, b: float) -> float:
    """Add two numbers together.

    Args:
        a: First number
        b: Second number

    Returns:
        The sum of a and b
    """
    return a + b


@mcp.tool()
def subtract(a: float, b: float) -> float:
    """Subtract second number from first number.

    Args:
        a: First number (minuend)
        b: Second number (subtrahend)

    Returns:
        The difference of a and b
    """
    return a - b


@mcp.tool()
def multiply(a: float, b: float) -> float:
    """Multiply two numbers together.

    Args:
        a: First number
        b: Second number

    Returns:
        The product of a and b
    """
    return a * b


@mcp.tool()
def divide(a: float, b: float) -> float:
    """Divide first number by second number.

    Args:
        a: Dividend
        b: Divisor

    Returns:
        The quotient of a and b

    Raises:
        ValueError: If attempting to divide by zero
    """
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b


@mcp.tool()
def power(base: float, exponent: float) -> float:
    """Calculate base raised to the power of exponent.

    Args:
        base: The base number
        exponent: The exponent

    Returns:
        base^exponent
    """
    return base ** exponent


@mcp.tool()
def square_root(x: float) -> float:
    """Calculate the square root of a number.

    Args:
        x: The number to find square root of

    Returns:
        The square root of x

    Raises:
        ValueError: If x is negative
    """
    if x < 0:
        raise ValueError("Cannot calculate square root of negative number")
    return x ** 0.5


if __name__ == "__main__":
    # Run the server with stdio transport
    mcp.run(transport="stdio")
